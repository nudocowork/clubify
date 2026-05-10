// Hotfix: la columna Card.validDaysAfterIssue nunca se aplicó a prod
// (el script original usaba `pg` que no está instalado en backend).
// Idempotente.
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
await prisma.$executeRawUnsafe(
  `ALTER TABLE "Card" ADD COLUMN IF NOT EXISTS "validDaysAfterIssue" INTEGER`,
);
console.log('OK Card.validDaysAfterIssue applied');
await prisma.$disconnect();
