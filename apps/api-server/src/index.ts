import express, { Request, Response } from 'express';
import cors from 'cors';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import { prisma } from '@rce/database';
import { storageService, BUCKET_SUBMISSIONS } from '@rce/storage';
import { submissionQueue } from '@rce/queue';

const app = express();
app.use(cors());
app.use(express.json());

// 1. Zod Schema for strict input validation
const submissionSchema = z.object({
  language: z.enum(['python', 'javascript', 'cpp']),
  code: z.string().min(1, "Code cannot be empty"),
  problemId: z.string().uuid("Invalid problem ID format").optional(), // Optional for sandbox mode
});

app.post('/api/submissions', async (req: Request, res: Response): Promise<any> => {
  try {
    // Validate the incoming payload
    const parsed = submissionSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ errors: parsed.error.format() });
    }

    const { language, code, problemId } = parsed.data;
    const submissionId = randomUUID();
    const codeS3Key = `submissions/${submissionId}.${language.toLowerCase()}`;
    
    // For this integration, if no problemId is provided, we auto-generate a dummy one
    const activeProblemId = problemId || randomUUID();

    // 2. Upload raw code to MinIO
    await storageService.initializeBuckets();
    await storageService.putPayload(BUCKET_SUBMISSIONS, codeS3Key, code);

    // Ensure dummy problem exists for sandbox testing
    if (!problemId) {
      await prisma.problem.upsert({
        where: { id: activeProblemId },
        update: {},
        create: {
          id: activeProblemId,
          title: 'Sandbox Execution',
          description: 'Freeform code execution',
          testCasesS3Key: 'mock/cases.json',
        }
      });
    }

    // 3. Create the Database Ledger (PENDING state)
    await prisma.submission.create({
      data: {
        id: submissionId,
        problemId: activeProblemId,
        userId: 'anonymous_user', // Replace with JWT user ID in production
        language: language,
        status: 'PENDING',
        codeS3Key: codeS3Key,
      }
    });

    // 4. Dispatch to Redis Queue
    await submissionQueue.add('execute-code', {
      submissionId,
      problemId: activeProblemId,
      language,
      codeS3Key,
      testCasesS3Key: 'mock/cases.json',
      timeLimitMs: 3000,
      memoryLimitMb: 256
    });

    // 5. Return immediately to the client
    return res.status(202).json({
      message: "Submission queued successfully",
      submissionId: submissionId,
      status: "PENDING"
    });

  } catch (error) {
    console.error("API Error:", error);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

app.get('/api/submissions/:id', async (req: Request, res: Response): Promise<any> => {
  try {
    const id = req.params.id as string;

    // Fetch the submission state from Postgres
    const submission = await prisma.submission.findUnique({
      where: { id }
    });

    if (!submission) {
      return res.status(404).json({ error: "Submission not found" });
    }

    // Return the current state to the user
    return res.status(200).json({
      id: submission.id,
      status: submission.status,
      language: submission.language,
      executionTimeMs: submission.executionTimeMs,
      memoryUsedMb: submission.memoryUsedMb,
      errorMessage: submission.errorMessage,
    });

  } catch (error) {
    console.error("API Error:", error);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

// ... app.listen(...)

const PORT = process.env.PORT || 8000;
app.listen(PORT, () => {
  console.log(`🚀 [API Node] Gateway listening on http://localhost:${PORT}`);
});