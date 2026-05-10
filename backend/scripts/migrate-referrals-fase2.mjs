// Fase 2 de Referidos: Campañas + roles + embajadores anidados.
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const sql = [
  // Enum nuevos — no soportan IF NOT EXISTS, hay que envolver en DO.
  `DO $$ BEGIN
     CREATE TYPE "ReferralRole" AS ENUM ('INFLUENCER','AMBASSADOR','SOCIO');
   EXCEPTION WHEN duplicate_object THEN null; END $$`,
  `DO $$ BEGIN
     CREATE TYPE "CampaignStatus" AS ENUM ('ACTIVE','PAUSED','FINISHED');
   EXCEPTION WHEN duplicate_object THEN null; END $$`,

  // ReferralCode: role + parent + campaign
  `ALTER TABLE "ReferralCode" ADD COLUMN IF NOT EXISTS "role" "ReferralRole" NOT NULL DEFAULT 'INFLUENCER'`,
  `ALTER TABLE "ReferralCode" ADD COLUMN IF NOT EXISTS "parentCodeId" TEXT`,
  `ALTER TABLE "ReferralCode" ADD COLUMN IF NOT EXISTS "campaignId" TEXT`,

  // Campaign — tabla nueva
  `CREATE TABLE IF NOT EXISTS "Campaign" (
     "id" TEXT NOT NULL PRIMARY KEY,
     "name" TEXT NOT NULL,
     "ownerCodeId" TEXT NOT NULL UNIQUE,
     "status" "CampaignStatus" NOT NULL DEFAULT 'ACTIVE',
     "discountAbsorption" TEXT NOT NULL DEFAULT 'PROPORTIONAL',
     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
   )`,

  // FKs (idempotentes)
  `DO $$ BEGIN
     IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
                    WHERE constraint_name = 'Campaign_ownerCodeId_fkey') THEN
       ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_ownerCodeId_fkey"
         FOREIGN KEY ("ownerCodeId") REFERENCES "ReferralCode"("id") ON DELETE CASCADE;
     END IF;
   END $$`,
  `DO $$ BEGIN
     IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
                    WHERE constraint_name = 'ReferralCode_parentCodeId_fkey') THEN
       ALTER TABLE "ReferralCode" ADD CONSTRAINT "ReferralCode_parentCodeId_fkey"
         FOREIGN KEY ("parentCodeId") REFERENCES "ReferralCode"("id") ON DELETE SET NULL;
     END IF;
   END $$`,
  `DO $$ BEGIN
     IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
                    WHERE constraint_name = 'ReferralCode_campaignId_fkey') THEN
       ALTER TABLE "ReferralCode" ADD CONSTRAINT "ReferralCode_campaignId_fkey"
         FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE SET NULL;
     END IF;
   END $$`,

  `CREATE INDEX IF NOT EXISTS "ReferralCode_parentCodeId_idx" ON "ReferralCode"("parentCodeId")`,
  `CREATE INDEX IF NOT EXISTS "ReferralCode_campaignId_idx" ON "ReferralCode"("campaignId")`,
];

for (const q of sql) {
  await prisma.$executeRawUnsafe(q);
}
console.log('OK', sql.length, 'statements applied');
await prisma.$disconnect();
