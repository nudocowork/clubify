// Migración Cuponera Fase 3 (beneficios + canjes):
//   20260709020400_add_cuponera_benefits → Benefit + Redemption + enums.
// Idempotente. Requiere que las migraciones de Fase 1 y 2 ya estén aplicadas.
//   node scripts/apply-cuponera-benefits-migration.cjs
const { PrismaClient } = require('@prisma/client');
const crypto = require('crypto');

const STMTS = [
  `DO $$ BEGIN CREATE TYPE "BenefitType" AS ENUM ('PERCENT_OFF','AMOUNT_OFF','TWO_FOR_ONE','FREEBIE','PRODUCT','OTHER'); EXCEPTION WHEN duplicate_object THEN null; END $$`,
  `DO $$ BEGIN CREATE TYPE "BenefitStatus" AS ENUM ('DRAFT','ACTIVE','PAUSED'); EXCEPTION WHEN duplicate_object THEN null; END $$`,
  `DO $$ BEGIN CREATE TYPE "BenefitApproval" AS ENUM ('PENDING','APPROVED','REJECTED'); EXCEPTION WHEN duplicate_object THEN null; END $$`,

  `CREATE TABLE IF NOT EXISTS "Benefit" (
      "id" TEXT NOT NULL,
      "campaignId" TEXT NOT NULL,
      "allyBusinessId" TEXT NOT NULL,
      "categoryId" TEXT,
      "type" "BenefitType" NOT NULL DEFAULT 'PERCENT_OFF',
      "title" TEXT NOT NULL,
      "description" TEXT NOT NULL DEFAULT '',
      "imageUrl" TEXT,
      "terms" TEXT NOT NULL DEFAULT '',
      "percentOff" INTEGER,
      "amountOffCents" INTEGER,
      "normalPriceCents" INTEGER,
      "memberPriceCents" INTEGER,
      "currency" TEXT NOT NULL DEFAULT 'COP',
      "validFrom" TIMESTAMP(3),
      "validUntil" TIMESTAMP(3),
      "maxRedemptions" INTEGER,
      "maxPerMember" INTEGER DEFAULT 1,
      "status" "BenefitStatus" NOT NULL DEFAULT 'ACTIVE',
      "approval" "BenefitApproval" NOT NULL DEFAULT 'APPROVED',
      "redemptionCount" INTEGER NOT NULL DEFAULT 0,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL,
      CONSTRAINT "Benefit_pkey" PRIMARY KEY ("id")
  )`,
  `CREATE INDEX IF NOT EXISTS "Benefit_campaignId_status_approval_idx" ON "Benefit"("campaignId","status","approval")`,
  `CREATE INDEX IF NOT EXISTS "Benefit_allyBusinessId_idx" ON "Benefit"("allyBusinessId")`,
  `CREATE INDEX IF NOT EXISTS "Benefit_categoryId_idx" ON "Benefit"("categoryId")`,

  `CREATE TABLE IF NOT EXISTS "Redemption" (
      "id" TEXT NOT NULL,
      "campaignId" TEXT NOT NULL,
      "benefitId" TEXT NOT NULL,
      "allyBusinessId" TEXT NOT NULL,
      "customerId" TEXT NOT NULL,
      "passId" TEXT,
      "operatorUserId" TEXT,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "Redemption_pkey" PRIMARY KEY ("id")
  )`,
  `CREATE INDEX IF NOT EXISTS "Redemption_benefitId_customerId_idx" ON "Redemption"("benefitId","customerId")`,
  `CREATE INDEX IF NOT EXISTS "Redemption_allyBusinessId_createdAt_idx" ON "Redemption"("allyBusinessId","createdAt")`,
  `CREATE INDEX IF NOT EXISTS "Redemption_campaignId_createdAt_idx" ON "Redemption"("campaignId","createdAt")`,

  `DO $$ BEGIN ALTER TABLE "Benefit" ADD CONSTRAINT "Benefit_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "BenefitCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN null; END $$`,
  `DO $$ BEGIN ALTER TABLE "Benefit" ADD CONSTRAINT "Benefit_allyBusinessId_fkey" FOREIGN KEY ("allyBusinessId") REFERENCES "AllyBusiness"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN null; END $$`,
  `DO $$ BEGIN ALTER TABLE "Benefit" ADD CONSTRAINT "Benefit_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "BenefitCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN null; END $$`,
  `DO $$ BEGIN ALTER TABLE "Redemption" ADD CONSTRAINT "Redemption_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "BenefitCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN null; END $$`,
  `DO $$ BEGIN ALTER TABLE "Redemption" ADD CONSTRAINT "Redemption_benefitId_fkey" FOREIGN KEY ("benefitId") REFERENCES "Benefit"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN null; END $$`,
  `DO $$ BEGIN ALTER TABLE "Redemption" ADD CONSTRAINT "Redemption_allyBusinessId_fkey" FOREIGN KEY ("allyBusinessId") REFERENCES "AllyBusiness"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN null; END $$`,
  `DO $$ BEGIN ALTER TABLE "Redemption" ADD CONSTRAINT "Redemption_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN null; END $$`,
];

(async () => {
  const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
  if (!url) { console.error('No DATABASE_URL'); process.exit(1); }
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  for (const sql of STMTS) await prisma.$executeRawUnsafe(sql);
  console.log('✅ DDL Cuponera Fase 3 (beneficios/canjes) aplicado (idempotente).');

  const name = '20260709020400_add_cuponera_benefits';
  const exists = await prisma.$queryRawUnsafe(
    `SELECT 1 FROM "_prisma_migrations" WHERE migration_name = $1 LIMIT 1`, name,
  );
  if (!exists.length) {
    await prisma.$executeRawUnsafe(
      `INSERT INTO "_prisma_migrations" (id, checksum, migration_name, started_at, finished_at, applied_steps_count)
       VALUES ($1, $2, $3, now(), now(), 1)`,
      crypto.randomUUID(), 'manual-apply', name,
    );
    console.log(`✅ Registrada migración ${name}.`);
  } else {
    console.log(`• ${name} ya estaba registrada.`);
  }
  await prisma.$disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
