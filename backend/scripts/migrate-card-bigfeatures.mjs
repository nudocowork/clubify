// Migración idempotente — usa Prisma Client (ya instalado) en lugar de pg.
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const sql = [
  `ALTER TABLE "Card" ADD COLUMN IF NOT EXISTS "termsEnabled" BOOLEAN NOT NULL DEFAULT true`,
  `ALTER TABLE "Card" ADD COLUMN IF NOT EXISTS "stampActiveColor" TEXT`,
  `ALTER TABLE "Card" ADD COLUMN IF NOT EXISTS "stampInactiveColor" TEXT`,
  `ALTER TABLE "Card" ADD COLUMN IF NOT EXISTS "stampContourColor" TEXT`,
  `ALTER TABLE "Card" ADD COLUMN IF NOT EXISTS "centerBgColor" TEXT`,
  `ALTER TABLE "Card" ADD COLUMN IF NOT EXISTS "locationId" TEXT`,
  `ALTER TABLE "Card" ADD COLUMN IF NOT EXISTS "howToEarnText" TEXT NOT NULL DEFAULT ''`,
  `ALTER TABLE "Card" ADD COLUMN IF NOT EXISTS "businessName" TEXT NOT NULL DEFAULT ''`,
  `ALTER TABLE "Card" ADD COLUMN IF NOT EXISTS "rewardDescText" TEXT NOT NULL DEFAULT ''`,
  `ALTER TABLE "Card" ADD COLUMN IF NOT EXISTS "stampEarnedMessage" TEXT NOT NULL DEFAULT ''`,
  `ALTER TABLE "Card" ADD COLUMN IF NOT EXISTS "rewardEarnedMessage" TEXT NOT NULL DEFAULT ''`,
  `ALTER TABLE "Card" ADD COLUMN IF NOT EXISTS "multiRewards" JSONB NOT NULL DEFAULT '[]'::jsonb`,
  `ALTER TABLE "Card" ADD COLUMN IF NOT EXISTS "activeLinks" JSONB NOT NULL DEFAULT '[]'::jsonb`,
  `DO $$
   BEGIN
     IF NOT EXISTS (
       SELECT 1 FROM information_schema.table_constraints
       WHERE constraint_name = 'Card_locationId_fkey'
     ) THEN
       ALTER TABLE "Card" ADD CONSTRAINT "Card_locationId_fkey"
         FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE SET NULL;
     END IF;
   END $$`,
  `CREATE INDEX IF NOT EXISTS "Card_locationId_idx" ON "Card"("locationId")`,
  `CREATE TABLE IF NOT EXISTS "CardUtmLink" (
     "id" TEXT NOT NULL PRIMARY KEY,
     "cardId" TEXT NOT NULL,
     "source" TEXT NOT NULL,
     "slug" TEXT NOT NULL UNIQUE,
     "welcomeStamps" INTEGER,
     "welcomePoints" DECIMAL(12,2),
     "bonusExpiresAt" TIMESTAMP(3),
     "useCount" INTEGER NOT NULL DEFAULT 0,
     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
     CONSTRAINT "CardUtmLink_cardId_fkey" FOREIGN KEY ("cardId")
       REFERENCES "Card"("id") ON DELETE CASCADE
   )`,
  `CREATE INDEX IF NOT EXISTS "CardUtmLink_cardId_idx" ON "CardUtmLink"("cardId")`,
];

for (const q of sql) {
  await prisma.$executeRawUnsafe(q);
}
console.log('OK', sql.length, 'statements applied');
await prisma.$disconnect();
