// Stamp.purchaseAmount: monto que el cliente pagó por la compra que motivó
// el scan. Solo informativo (alimenta KPIs de facturación), no afecta los
// sellos otorgados (1 scan = 1 sello). Idempotente.
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
await prisma.$executeRawUnsafe(
  `ALTER TABLE "Stamp" ADD COLUMN IF NOT EXISTS "purchaseAmount" DECIMAL(12,2)`,
);
console.log('OK Stamp.purchaseAmount applied');
await prisma.$disconnect();
