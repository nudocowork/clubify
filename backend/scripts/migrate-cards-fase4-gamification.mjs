// Fase 4 cards expansion: gamificación.
// - Customer: xpPoints, currentLevel, currentStreakDays, longestStreakDays, lastVisitDay
// - Badge: nuevo modelo
// - CustomerBadge: nuevo modelo (M2M earned)
// Idempotente.
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const sql = [
  // Customer fields
  `ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS "xpPoints" INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS "currentLevel" INTEGER NOT NULL DEFAULT 1`,
  `ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS "currentStreakDays" INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS "longestStreakDays" INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS "lastVisitDay" TEXT`,
  // Badge model
  `CREATE TABLE IF NOT EXISTS "Badge" (
     "id" TEXT NOT NULL PRIMARY KEY,
     "tenantId" TEXT NOT NULL,
     "name" TEXT NOT NULL,
     "description" TEXT NOT NULL DEFAULT '',
     "icon" TEXT NOT NULL DEFAULT '🏅',
     "color" TEXT NOT NULL DEFAULT '#F59E0B',
     "criteria" JSONB NOT NULL DEFAULT '{}'::jsonb,
     "xpReward" INTEGER NOT NULL DEFAULT 50,
     "isActive" BOOLEAN NOT NULL DEFAULT true,
     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
     CONSTRAINT "Badge_tenantId_fkey" FOREIGN KEY ("tenantId")
       REFERENCES "Tenant"("id") ON DELETE CASCADE
   )`,
  `CREATE INDEX IF NOT EXISTS "Badge_tenantId_idx" ON "Badge"("tenantId")`,
  // CustomerBadge join
  `CREATE TABLE IF NOT EXISTS "CustomerBadge" (
     "id" TEXT NOT NULL PRIMARY KEY,
     "customerId" TEXT NOT NULL,
     "badgeId" TEXT NOT NULL,
     "earnedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
     CONSTRAINT "CustomerBadge_customerId_fkey" FOREIGN KEY ("customerId")
       REFERENCES "Customer"("id") ON DELETE CASCADE,
     CONSTRAINT "CustomerBadge_badgeId_fkey" FOREIGN KEY ("badgeId")
       REFERENCES "Badge"("id") ON DELETE CASCADE
   )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "CustomerBadge_customerId_badgeId_key"
     ON "CustomerBadge"("customerId", "badgeId")`,
  `CREATE INDEX IF NOT EXISTS "CustomerBadge_customerId_idx"
     ON "CustomerBadge"("customerId")`,
];

for (const q of sql) {
  console.log('→', q.slice(0, 80).replace(/\s+/g, ' '));
  await prisma.$executeRawUnsafe(q);
}
console.log('OK', sql.length, 'statements applied');
await prisma.$disconnect();
