export interface SubmissionJobPayload {
  submissionId: string;
  problemId: string;
  language: 'PYTHON' | 'JAVASCRIPT' | 'CPP';
  codeS3Key: string;
  testCasesS3Key: string;
  timeLimitMs: number;
  memoryLimitMb: number;
}