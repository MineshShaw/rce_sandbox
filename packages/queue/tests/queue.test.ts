import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { 
  submissionQueue, 
  Worker, 
  QueueEvents, 
  SUBMISSION_QUEUE_NAME, 
  redisConnection 
} from '../src/index';

describe('Phase 3: Redis & BullMQ Message Broker', () => {
  let mockWorker: Worker;
  let queueEvents: QueueEvents;

  beforeAll(async () => {
    // 1. Clear the queue to ensure a pristine test environment
    await submissionQueue.obliterate({ force: true });

    // 2. Setup Event Listener to monitor job lifecycles in real-time
    queueEvents = new QueueEvents(SUBMISSION_QUEUE_NAME, { 
      connection: redisConnection as any 
    });

    // 3. Setup a Mock Worker to consume the jobs
    mockWorker = new Worker(SUBMISSION_QUEUE_NAME, async (job) => {
      // Simulate a Worker Crash (Poison Pill) if the language is CPP
      if (job.data.language === 'CPP') {
        throw new Error('Simulated Worker Crash: Segmentation Fault');
      }
      
      // Simulate successful code execution delay
      await new Promise(resolve => setTimeout(resolve, 100));
      
      return { success: true, processedId: job.data.submissionId };
    }, { connection: redisConnection as any });
  });

  afterAll(async () => {
    // Gracefully shut down all Redis connections so Vitest can exit cleanly
    await mockWorker.close();
    await queueEvents.close();
    await submissionQueue.close();
    await redisConnection.quit();
  });

  it('1. Producer should add a job and Consumer should process it successfully', async () => {
    // Add the job to the Redis Queue
    const job = await submissionQueue.add('execute-code', {
      submissionId: 'sub_123',
      problemId: 'prob_1',
      language: 'PYTHON',
      codeS3Key: 'submissions/sub_123.py',
      testCasesS3Key: 'problems/prob_1/tests.json',
      timeLimitMs: 3000,
      memoryLimitMb: 256
    });

    expect(job.id).toBeDefined();

    // Block and wait for the mock worker to finish processing the job
    const result = await job.waitUntilFinished(queueEvents);
    
    expect(result.success).toBe(true);
    expect(result.processedId).toBe('sub_123');
    
    // Verify it was cleared from the active queue
    const state = await job.getState();
    expect(state).toBe('unknown');
  });

  it('2. Should handle poison pills and route crashes to the Dead Letter Queue', async () => {
    // Add a job designed to crash the worker
    const poisonJob = await submissionQueue.add('execute-code', {
      submissionId: 'sub_999',
      problemId: 'prob_2',
      language: 'CPP',
      codeS3Key: 'submissions/sub_999.cpp',
      testCasesS3Key: 'problems/prob_2/tests.json',
      timeLimitMs: 3000,
      memoryLimitMb: 256
    });

    try {
      await poisonJob.waitUntilFinished(queueEvents);
    } catch (error: any) {
      // BullMQ catches the worker crash and passes the error message back to the event listener
      expect(error.message).toContain('Simulated Worker Crash: Segmentation Fault');
    }

    // Verify the job was NOT retried (attempts: 1) and was safely marked as failed (DLQ)
    const state = await poisonJob.getState();
    expect(state).toBe('failed');
  });
});