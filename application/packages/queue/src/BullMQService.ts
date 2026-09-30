import { Queue, Worker, QueueEvents, Job } from 'bullmq';
import IORedis from 'ioredis';
import { SubmissionJobPayload } from './types';
import { IQueuePublisher } from './IQueuePublisher';
import { IQueueWorker } from './IQueueWorker';
import { IQueueEventsListener } from './IQueueEventsListener';

const SUBMISSION_QUEUE_NAME = 'rce-submissions';

export const redisConnection = new IORedis(process.env.REDIS_URL || 'redis://localhost:6379', {
  maxRetriesPerRequest: null, // CRITICAL: Required by BullMQ to prevent blocking command timeouts
});

export class BullMQPublisher implements IQueuePublisher {
  private queue = new Queue<SubmissionJobPayload>(SUBMISSION_QUEUE_NAME, {
    connection: redisConnection as any,
    defaultJobOptions: { attempts: 1, removeOnComplete: true, removeOnFail: 1000 },
  });

  async publishSubmission(jobId: string, payload: SubmissionJobPayload): Promise<void> {
    await this.queue.add('execute-code', payload, { jobId });
  }
}

export class BullMQEventsListener implements IQueueEventsListener {
  private events = new QueueEvents(SUBMISSION_QUEUE_NAME, { connection: redisConnection as any });

  onWaiting(callback: (jobId: string) => void) {
    this.events.on('waiting', ({ jobId }) => callback(jobId));
  }
  onActive(callback: (jobId: string) => void) {
    this.events.on('active', ({ jobId }) => callback(jobId));
  }
  onCompleted(callback: (jobId: string) => void) {
    this.events.on('completed', ({ jobId }) => callback(jobId));
  }
  onFailed(callback: (jobId: string, reason: string) => void) {
    this.events.on('failed', ({ jobId, failedReason }) => callback(jobId, failedReason));
  }
  onError(callback: (error: Error) => void) {
    this.events.on('error', (err) => callback(err));
  }
}

export class BullMQWorker implements IQueueWorker {
  private worker: Worker<SubmissionJobPayload> | null = null;

  startProcessing(handler: (jobId: string, payload: SubmissionJobPayload) => Promise<void>) {
    this.worker = new Worker<SubmissionJobPayload>(
      SUBMISSION_QUEUE_NAME,
      async (job: Job) => {
        await handler(job.id!, job.data);
      },
      { connection: redisConnection as any, concurrency: 5 }
    );
  }

  async close() {
    if (this.worker) await this.worker.close();
  }
}