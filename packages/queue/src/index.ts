import { Queue, Worker, QueueEvents, Job } from 'bullmq';
import IORedis from 'ioredis';

// 1. Establish the specialized Redis connection for BullMQ
export const redisConnection = new IORedis(process.env.REDIS_URL || 'redis://localhost:6379', {
  maxRetriesPerRequest: null, // CRITICAL: Required by BullMQ to prevent blocking command timeouts
});

export const SUBMISSION_QUEUE_NAME = 'rce-submissions';

// 2. Define the strict contract for our Queue payload
// Notice we pass IDs and limits, but NOT the raw code or test cases!
export interface SubmissionJobPayload {
  submissionId: string;
  problemId: string;
  language: 'PYTHON' | 'JAVASCRIPT' | 'CPP';
  codeS3Key: string;
  testCasesS3Key: string;
  timeLimitMs: number;
  memoryLimitMb: number;
}

// 3. Export the Singleton Queue (Used primarily by the API Node to Add jobs)
export const submissionQueue = new Queue<SubmissionJobPayload>(SUBMISSION_QUEUE_NAME, {
  connection: redisConnection as any,
  defaultJobOptions: {
    attempts: 1, // We do not retry code execution. If it fails, it fails.
    removeOnComplete: true, // Keep Redis memory lean
    removeOnFail: 1000,     // Keep the last 1000 failed jobs for the Dead Letter Queue (DLQ)
  }
});

// Export BullMQ classes so the Worker Node can build its consumers
export { Worker, QueueEvents, Job };