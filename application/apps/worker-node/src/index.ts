import { prisma } from '@rce/database';
import { storageService, BUCKET_SUBMISSIONS } from '@rce/storage';
import { DockerSandbox } from './sandbox/DockerSandbox';
import { queueWorker } from '@rce/queue';

async function bootstrap() {
  console.log('🚀 Worker Node starting...');

  // The Worker no longer cares about BullMQ or Redis. 
  // It just provides a callback for what to do when a payload arrives.
  queueWorker.startProcessing(async (jobId, payload) => {
    console.log(`[Worker] Picked up job ${jobId} for language: ${payload.language}`);
    
    // 1. Mark as running in DB
    await prisma.submission.update({
      where: { id: jobId },
      data: { status: 'RUNNING' }
    });

    const startTime = Date.now();
    let sandboxResult;

    try {
      // 2. Download code from Storage
      const rawCode = await storageService.getPayload(BUCKET_SUBMISSIONS, payload.codeS3Key);

      // 3. Execute in Sandbox
      const sandbox = new DockerSandbox({
        timeoutMs: payload.timeLimitMs,
        memoryLimitBytes: payload.memoryLimitMb * 1024 * 1024,
      });

      sandboxResult = await sandbox.execute(payload.language, rawCode);

    } catch (error: any) {
      console.error(`[Worker] Critical error processing job ${jobId}:`, error);
      await prisma.submission.update({
        where: { id: jobId },
        data: {
          status: 'SYSTEM_ERROR',
          errorMessage: error.message || 'Internal sandbox failure',
          executionTimeMs: Date.now() - startTime,
        }
      });
      throw error; // Let the queue know it failed
    }

    // 4. Save results back to DB
    let finalStatus: any = 'COMPLETED';

    if (sandboxResult.isTimeout) {
      finalStatus = 'TIME_LIMIT_EXCEEDED';
    } else if (sandboxResult.isOOM) {
      finalStatus = 'MEMORY_LIMIT_EXCEEDED';
    } else if (sandboxResult.exitCode !== 0) {
      finalStatus = 'RUNTIME_ERROR';
    }

    const isSuccess = sandboxResult.exitCode === 0;
    await prisma.submission.update({
      where: { id: jobId },
      data: {
        status: finalStatus,
        stdout: sandboxResult.stdout,
        errorMessage: sandboxResult.stderr,
        executionTimeMs: Date.now() - startTime,
        memoryUsedMb: 0, // We can calculate this later based on Docker stats
      }
    });

    console.log(`[Worker] Finished job ${jobId} with status: ${isSuccess ? 'SUCCESS' : 'FAILED'}`);
  });

  console.log('✅ Worker Node is now listening for jobs...');
}

// Handle graceful shutdown
process.on('SIGINT', async () => {
  console.log('Gracefully shutting down worker...');
  await queueWorker.close();
  process.exit(0);
});

bootstrap();