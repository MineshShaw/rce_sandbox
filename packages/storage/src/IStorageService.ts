export interface IStorageService {
  initializeBuckets(): Promise<void>;
  putPayload(bucket: string, key: string, body: string): Promise<void>;
  getPayload(bucket: string, key: string): Promise<string>;
}