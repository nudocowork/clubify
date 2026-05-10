import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
const sql = [
  `ALTER TABLE "ReferralCode" ADD COLUMN IF NOT EXISTS "approvedAt" TIMESTAMP(3)`,
  // Backfill: códigos existentes se consideran aprobados (no rompemos comisiones).
  `UPDATE "ReferralCode" SET "approvedAt" = "createdAt" WHERE "approvedAt" IS NULL`,
];
for (const q of sql) await prisma.$executeRawUnsafe(q);
console.log('OK', sql.length);
await prisma.$disconnect();
