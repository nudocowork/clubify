import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
const sql = [
  `ALTER TABLE "Commission" ADD COLUMN IF NOT EXISTS "notes" TEXT`,
  `ALTER TABLE "Commission" ADD COLUMN IF NOT EXISTS "clientContactedAt" TIMESTAMP(3)`,
];
for (const q of sql) await prisma.$executeRawUnsafe(q);
console.log('OK', sql.length);
await prisma.$disconnect();
