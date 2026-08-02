import { Worker, Job, SubmissionJobPayload, SUBMISSION_QUEUE_NAME, redisConnection } from '@rce/queue';
import { prisma } from '@rce/database';
import { storageService, BUCKET_SUBMISSIONS } from '@rce/storage';
import { DockerSandbox } from './sandbox/DockerSandbox';

console.log('🚀 [Worker Node] Booting up...');

const worker = new Worker<SubmissionJobPayload>(
  SUBMISSION_QUEUE_NAME,
  async (job: Job<SubmissionJobPayload>) => {
    const { submissionId, language, codeS3Key, timeLimitMs, memoryLimitMb } = job.data;
    const startTime = Date.now();

    console.log(`[Job ${submissionId}] Picked up from queue.`);

    try {
      // 1. STATE TRANSITION: PENDING -> RUNNING
      await prisma.submission.update({
        where: { id: submissionId },
        data: { status: 'RUNNING' }
      });

      // 2. FETCH PAYLOAD: Download user code from MinIO
      const sourceCode = await storageService.getPayload(BUCKET_SUBMISSIONS, codeS3Key);

      // 3. EXECUTE: Spin up the secure Docker container per job
      // We pass the specific time/memory limits defined by the Problem schema
      const customSandbox = new DockerSandbox({
        timeoutMs: timeLimitMs,
        memoryLimitBytes: memoryLimitMb * 1024 * 1024,
      });

      const result = await customSandbox.execute(language, sourceCode);
      const executionTimeMs = Date.now() - startTime;

      // 4. DETERMINE FINAL STATUS
      let finalStatus: any = 'COMPLETED';
      let errorMessage = '';

      if (result.isTimeout) {
        finalStatus = 'TIME_LIMIT_EXCEEDED';
        errorMessage = 'Time Limit Exceeded';
      } else if (result.isOOM) {
        finalStatus = 'MEMORY_LIMIT_EXCEEDED';
        errorMessage = 'Memory Limit Exceeded';
      } else if (result.exitCode !== 0) {
        finalStatus = 'RUNTIME_ERROR';
        errorMessage = result.stderr || 'Non-zero exit code encountered.';
      }

      // 5. STATE TRANSITION: RUNNING -> FINAL
      await prisma.submission.update({
        where: { id: submissionId },
        data: {
          status: finalStatus,
          executionTimeMs,
          errorMessage: errorMessage || null,
          stdout: result.stdout || null,
        }
      });

      console.log(`[Job ${submissionId}] Finished with status: ${finalStatus}`);
      
      // THE FIX: Return the stdout so BullMQ can pass it back to the Producer!
      return { 
        success: true, 
        status: finalStatus, 
        output: result.stdout 
      };

    } catch (error: any) {
      console.error(`[Job ${submissionId}] Critical System Error:`, error);
      
      // If the infrastructure fails (e.g., MinIO is down), record a SYSTEM_ERROR
      // (Wrapped in a try/catch just in case the DB is the thing that crashed!)
      try {
        await prisma.submission.update({
          where: { id: submissionId },
          data: {
            status: 'SYSTEM_ERROR',
            errorMessage: error.message,
          }
        });
      } catch (dbError) {
        console.error(`[Job ${submissionId}] Failed to update DB with SYSTEM_ERROR`, dbError);
      }
      
      throw error; // Rethrow so BullMQ can route it to the Dead Letter Queue
    }
  },
  { 
    connection: redisConnection as any,
    concurrency: 5, // Process up to 5 containers simultaneously per Worker Node
  }
);

worker.on('ready', () => {
  console.log(`✅ [Worker Node] Listening for jobs on queue: ${SUBMISSION_QUEUE_NAME}`);
});

worker.on('error', (err) => {
  console.error('❌ [Worker Node] BullMQ Error:', err);
});