// Fase 1 cards expansion: tipos nuevos (CASHBACK/VISITS/HYBRID) + tiers VIP +
// nuevos campos en Pass (cashbackBalance/visitsCount/currentTier/tierProgress).
// Idempotente — usa IF NOT EXISTS y DO blocks.
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const sql = [
  // Enum CardType: agregar CASHBACK, VISITS, HYBRID
  `ALTER TYPE "CardType" ADD VALUE IF NOT EXISTS 'CASHBACK'`,
  `ALTER TYPE "CardType" ADD VALUE IF NOT EXISTS 'VISITS'`,
  `ALTER TYPE "CardType" ADD VALUE IF NOT EXISTS 'HYBRID'`,
  // Enum StampAction: agregar CASHBACK_ADD, CASHBACK_REDEEM
  `ALTER TYPE "StampAction" ADD VALUE IF NOT EXISTS 'CASHBACK_ADD'`,
  `ALTER TYPE "StampAction" ADD VALUE IF NOT EXISTS 'CASHBACK_REDEEM'`,
  // Card: nuevos campos para CASHBACK/VISITS/MEMBERSHIP-tiers
  `ALTER TABLE "Card" ADD COLUMN IF NOT EXISTS "cashbackPercent" INTEGER`,
  `ALTER TABLE "Card" ADD COLUMN IF NOT EXISTS "cashbackMinPurchase" DECIMAL(12,2)`,
  `ALTER TABLE "Card" ADD COLUMN IF NOT EXISTS "visitsRequired" INTEGER`,
  `ALTER TABLE "Card" ADD COLUMN IF NOT EXISTS "tiers" JSONB NOT NULL DEFAULT '[]'::jsonb`,
  `ALTER TABLE "Card" ADD COLUMN IF NOT EXISTS "tierMetric" TEXT NOT NULL DEFAULT 'spend'`,
  // Pass: nuevos balances + tier
  `ALTER TABLE "Pass" ADD COLUMN IF NOT EXISTS "cashbackBalance" DECIMAL(12,2) NOT NULL DEFAULT 0`,
  `ALTER TABLE "Pass" ADD COLUMN IF NOT EXISTS "visitsCount" INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE "Pass" ADD COLUMN IF NOT EXISTS "currentTier" TEXT`,
  `ALTER TABLE "Pass" ADD COLUMN IF NOT EXISTS "tierProgress" DECIMAL(12,2) NOT NULL DEFAULT 0`,
];

for (const q of sql) {
  console.log('→', q.slice(0, 80).replace(/\s+/g, ' '));
  await prisma.$executeRawUnsafe(q);
}
console.log('OK', sql.length, 'statements applied');
await prisma.$disconnect();
