import { S3Client, PutObjectCommand, GetObjectCommand, CreateBucketCommand, HeadBucketCommand } from '@aws-sdk/client-s3';
import { Readable } from 'stream';
import { IStorageService } from './IStorageService';

export const BUCKET_SUBMISSIONS = 'rce-submissions';
export const BUCKET_PROBLEMS = 'rce-problems';

export class S3StorageService implements IStorageService {
  private s3: S3Client;

  constructor() {
    this.s3 = new S3Client({
      region: 'us-east-1', // Required by the SDK, but ignored by MinIO
      endpoint: process.env.S3_ENDPOINT || 'http://localhost:9000',
      forcePathStyle: true, // CRITICAL: Required for MinIO local development
      credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY || 'admin',
        secretAccessKey: process.env.S3_SECRET_KEY || 'adminpassword',
      },
    });
  }

  public async initializeBuckets(): Promise<void> {
    const buckets = [BUCKET_SUBMISSIONS, BUCKET_PROBLEMS];

    for (const bucket of buckets) {
      try {
        await this.s3.send(new HeadBucketCommand({ Bucket: bucket }));
        console.log(`[Storage] Bucket '${bucket}' already exists.`);
      } catch (error: any) {
        if (error.$metadata?.httpStatusCode === 404) {
          console.log(`[Storage] Creating bucket '${bucket}'...`);
          await this.s3.send(new CreateBucketCommand({ Bucket: bucket }));
        } else {
          throw error;
        }
      }
    }
  }

  public async putPayload(bucket: string, key: string, body: string): Promise<void> {
    await this.s3.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: body,
        ContentType: 'text/plain',
      })
    );
  }

  public async getPayload(bucket: string, key: string): Promise<string> {
    const response = await this.s3.send(
      new GetObjectCommand({
        Bucket: bucket,
        Key: key,
      })
    );

    if (!response.Body) {
      throw new Error(`File not found: ${bucket}/${key}`);
    }

    const stream = response.Body as Readable;
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      stream.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
      stream.on('error', (err) => reject(err));
      stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    });
  }
}