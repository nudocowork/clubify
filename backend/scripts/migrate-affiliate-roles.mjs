import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
const sql = [
  `ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'AFFILIATE_INFLUENCER'`,
  `ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'AFFILIATE_AMBASSADOR'`,
];
for (const q of sql) await prisma.$executeRawUnsafe(q);
console.log('OK', sql.length);
await prisma.$disconnect();
