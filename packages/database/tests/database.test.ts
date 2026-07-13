import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import prisma from '../src/index';
import { storageService, BUCKET_SUBMISSIONS, BUCKET_PROBLEMS } from '../../storage/src/index';

describe('Phase 2: Database & Storage Integration Pipeline', () => {
  let problemId: string;
  let submissionId: string;
  
  const testCode = 'print("Hello from the MinIO Object Store!")';
  const s3Key = 'test-submissions/sub_999.py';

  beforeAll(async () => {
    // 1. Ensure our S3 buckets exist before doing anything
    await storageService.initializeBuckets();
  });

  afterAll(async () => {
    // 2. Cleanup PostgreSQL to keep the dev environment pristine
    if (problemId) {
      await prisma.problem.delete({ where: { id: problemId } });
    }
  });

  it('1. Should create a new Problem in PostgreSQL', async () => {
    const problem = await prisma.problem.create({
      data: {
        title: 'Two Sum',
        description: 'Find two numbers that add up to target.',
        testCasesS3Key: 'problems/two-sum/tests.json',
      }
    });
    
    problemId = problem.id;
    
    expect(problem.id).toBeDefined();
    // Verify it picked up the default limits from our schema
    expect(problem.timeLimitMs).toBe(3000); 
    expect(problem.memoryLimitMb).toBe(256);
  });

  it('2. Should upload the user source code to MinIO', async () => {
    // Simulate API Node uploading code
    await storageService.putPayload(BUCKET_SUBMISSIONS, s3Key, testCode);
    
    // Simulate Worker Node downloading code
    const downloadedCode = await storageService.getPayload(BUCKET_SUBMISSIONS, s3Key);
    
    expect(downloadedCode).toBe(testCode);
  });

  it('3. Should create a PENDING Submission in Postgres with the MinIO key', async () => {
    const submission = await prisma.submission.create({
      data: {
        problemId: problemId,
        userId: 'user_123',
        language: 'PYTHON',
        status: 'PENDING',
        codeS3Key: s3Key,
      }
    });
    
    submissionId = submission.id;
    
    expect(submission.status).toBe('PENDING');
    expect(submission.codeS3Key).toBe(s3Key);
  });

  it('4. Should successfully transition State Machine (PENDING -> RUNNING -> COMPLETED)', async () => {
    // Step A: Worker picks up the job from the queue
    const runningSub = await prisma.submission.update({
      where: { id: submissionId },
      data: { status: 'RUNNING' }
    });
    
    expect(runningSub.status).toBe('RUNNING');

    // Step B: Worker finishes execution and reports metrics
    const completedSub = await prisma.submission.update({
      where: { id: submissionId },
      data: { 
        status: 'COMPLETED',
        executionTimeMs: 42,
        memoryUsedMb: 12.5
      }
    });
    
    expect(completedSub.status).toBe('COMPLETED');
    expect(completedSub.executionTimeMs).toBe(42);
    expect(completedSub.memoryUsedMb).toBe(12.5);
  });
});