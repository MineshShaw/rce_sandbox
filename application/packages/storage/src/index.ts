export * from './IStorageService';
export * from './S3StorageService';

import { IStorageService } from './IStorageService';
import { S3StorageService } from './S3StorageService';

export const BUCKET_SUBMISSIONS = 'rce-submissions';
export const BUCKET_PROBLEMS = 'rce-problems';

export const storageService: IStorageService = new S3StorageService();