import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

export * from '@prisma/client';

const connectionString = process.env.DATABASE_URL || "postgresql://root:rootpassword@localhost:5433/rce_sandbox?schema=public";

const pool = new Pool({ connectionString });

const adapter = new PrismaPg(pool);

const prisma = new PrismaClient({ adapter });

export default prisma;
