import { submissionQueue, QueueEvents, SUBMISSION_QUEUE_NAME, redisConnection } from '@rce/queue';
import { prisma } from '@rce/database';
import { storageService, BUCKET_SUBMISSIONS } from '@rce/storage';
import { randomUUID } from 'crypto';

async function inject() {
  const problemId = randomUUID();
  const submissionId = randomUUID();
  const codeKey = `submissions/${submissionId}.py`;
  
  // Let's run some actual logic to prove the engine works
  const pythonCode = `
def fibonacci(n):
    if n <= 1:
        return n
    return fibonacci(n-1) + fibonacci(n-2)

print("🚀 Initializing Code Execution inside Docker...")
print(f"Result of fib(12) is: {fibonacci(12)}")
print("✅ Execution Complete!")
`;

  console.log('1. 📦 Uploading code to MinIO...');
  await storageService.initializeBuckets();
  await storageService.putPayload(BUCKET_SUBMISSIONS, codeKey, pythonCode);

  console.log('2. 🗄️ Creating Database records...');
  await prisma.problem.create({
    data: {
      id: problemId,
      title: 'Fibonacci Sequence',
      description: 'Calculate the nth Fibonacci number',
      testCasesS3Key: 'mock/cases.json',
    }
  });

  await prisma.submission.create({
    data: {
      id: submissionId,
      problemId: problemId,
      userId: 'user_live_test',
      language: 'python',
      status: 'PENDING',
      codeS3Key: codeKey,
    }
  });

  // Set up an Event Listener to hear back from the Worker
  const queueEvents = new QueueEvents(SUBMISSION_QUEUE_NAME, {
    connection: redisConnection as any
  });

  console.log('3. 🚀 Pushing job to Redis Queue...');
  const job = await submissionQueue.add('execute-code', {
    submissionId: submissionId,
    problemId: problemId,
    language: 'python',
    codeS3Key: codeKey,
    testCasesS3Key: 'mock/cases.json',
    timeLimitMs: 3000,
    memoryLimitMb: 256
  });

  console.log(`⏳ Waiting for Worker Node to process job...`);

  // Block execution until the worker finishes and grabs the return value
  const workerResult = await job.waitUntilFinished(queueEvents);

  console.log('\n=========================================');
  console.log('🎉 JOB COMPLETED!');
  console.log('Final Database Status:', workerResult.status);
  console.log('\n--- TERMINAL OUTPUT ---');
  console.log(workerResult.output); // This is where the magic happens!
  console.log('=========================================\n');

  // Cleanup connections so the script exits cleanly
  await queueEvents.close();
  process.exit(0);
}

inject();