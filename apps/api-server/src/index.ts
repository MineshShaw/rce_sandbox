import express, { Request, Response } from 'express';
import cors from 'cors';
import http from 'http'
import { z } from 'zod';
import { randomUUID } from 'crypto';
import { prisma } from '@rce/database';
import { storageService, BUCKET_SUBMISSIONS } from '@rce/storage';
import { submissionQueue, SUBMISSION_QUEUE_NAME } from '@rce/queue';
import { Server } from 'socket.io'
import { QueueEvents } from 'bullmq';

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {origin: '*'},
})

io.on('connection', (socket) => {
  socket.on('subscribeToJob', (submissionId: string) => {
    socket.join(submissionId);
    console.log(`Client subscribed to updates for job ${submissionId}`);
  })
})

const queueEvents = new QueueEvents(SUBMISSION_QUEUE_NAME, {
  connection: { host: '127.0.0.1', port: 6379 },
});

// 1. Catch Redis connection errors
queueEvents.on('error', (err) => {
  console.error('🚨 [QueueEvents] Redis Connection Error:', err);
});

// 2. Track when the job is first added
queueEvents.on('waiting', ({ jobId }) => {
  console.log(`📥 [QueueEvents] Job ${jobId} is waiting in the queue`);
});

// 3. Track when the worker picks it up
queueEvents.on('active', ({ jobId }) => {
  console.log(`⚙️ [QueueEvents] Worker started processing Job ${jobId}`);
});

// 4. Track completion
queueEvents.on('completed', async ({ jobId }) => {
  console.log(`✅ [QueueEvents] Worker finished Job ${jobId}`);
  
  const submission = await prisma.submission.findUnique({ where: { id: jobId } });
  if (submission) {
    console.log(`📡 [Socket] Emitting 'jobComplete' to room ${jobId}`);
    io.to(jobId).emit('jobComplete', submission);
  } else {
    console.log(`❌ [Error] Job ${jobId} completed but not found in DB!`);
  }
});

// 5. Track failure
queueEvents.on('failed', async ({ jobId, failedReason }) => {
  console.log(`❌ [QueueEvents] Worker failed Job ${jobId}. Reason: ${failedReason}`);
  
  const submission = await prisma.submission.findUnique({ where: { id: jobId } });
  if (submission) {
    io.to(jobId).emit('jobComplete', submission);
  }
});

// 1. Zod Schema for strict input validation
const submissionSchema = z.object({
  language: z.enum(['PYTHON', 'JAVASCRIPT', 'CPP']),
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
    },{ jobId: submissionId });

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
      output: submission.stdout,
    });

  } catch (error) {
    console.error("API Error:", error);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

const PORT = process.env.PORT || 8000;
server.listen(PORT, () => {
  console.log(`🚀 [API Node] Gateway listening on http://localhost:${PORT}`);
});