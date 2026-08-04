import { SubmissionJobPayload } from './types';

export interface IQueueWorker {
  startProcessing(handler: (jobId: string, payload: SubmissionJobPayload) => Promise<void>): void;
  close(): Promise<void>;
}