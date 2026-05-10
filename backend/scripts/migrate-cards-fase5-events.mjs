// Fase 5 cards expansion: agregar nuevos AutomationEvent values.
// Idempotente.
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const sql = [
  // PASS_COMPLETED y ORDER_RATED ya estaban en el código pero faltaban en el enum DB
  `ALTER TYPE "AutomationEvent" ADD VALUE IF NOT EXISTS 'PASS_COMPLETED'`,
  `ALTER TYPE "AutomationEvent" ADD VALUE IF NOT EXISTS 'ORDER_RATED'`,
  `ALTER TYPE "AutomationEvent" ADD VALUE IF NOT EXISTS 'NEAR_REWARD'`,
];

for (const q of sql) {
  console.log('→', q.slice(0, 80).replace(/\s+/g, ' '));
  await prisma.$executeRawUnsafe(q);
}
console.log('OK', sql.length, 'statements applied');
await prisma.$disconnect();
