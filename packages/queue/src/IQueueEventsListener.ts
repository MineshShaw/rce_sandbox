export interface IQueueEventsListener {
  onWaiting(callback: (jobId: string) => void): void;
  onActive(callback: (jobId: string) => void): void;
  onCompleted(callback: (jobId: string) => void): void;
  onFailed(callback: (jobId: string, reason: string) => void): void;
  onError(callback: (error: Error) => void): void;
}