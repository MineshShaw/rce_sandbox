import { SubmissionJobPayload } from './types';

export interface IQueuePublisher {
  publishSubmission(jobId: string, payload: SubmissionJobPayload): Promise<void>;
}