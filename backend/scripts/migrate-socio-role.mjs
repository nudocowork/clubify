import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
await prisma.$executeRawUnsafe(`ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'AFFILIATE_SOCIO'`);
console.log('OK');
await prisma.$disconnect();
