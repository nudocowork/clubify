// Migración Cuponera Fase 5 (sellos comunitarios):
//   20260709020500_add_cuponera_stamps → StampProgram + StampCard + StampEvent.
// Idempotente. Requiere Fases 1-3 aplicadas.
//   node scripts/apply-cuponera-stamps-migration.cjs
const { PrismaClient } = require('@prisma/client');
const crypto = require('crypto');

const STMTS = [
  `DO $$ BEGIN CREATE TYPE "StampProgramStatus" AS ENUM ('ACTIVE','PAUSED'); EXCEPTION WHEN duplicate_object THEN null; END $$`,
  `DO $$ BEGIN CREATE TYPE "StampEventAction" AS ENUM ('STAMP','REDEEM'); EXCEPTION WHEN duplicate_object THEN null; END $$`,

  `CREATE TABLE IF NOT EXISTS "StampProgram" (
      "id" TEXT NOT NULL,
      "campaignId" TEXT NOT NULL,
      "categoryId" TEXT,
      "name" TEXT NOT NULL,
      "description" TEXT NOT NULL DEFAULT '',
      "imageUrl" TEXT,
      "stampsRequired" INTEGER NOT NULL DEFAULT 5,
      "rewardText" TEXT NOT NULL DEFAULT '',
      "maxPerDay" INTEGER NOT NULL DEFAULT 1,
      "status" "StampProgramStatus" NOT NULL DEFAULT 'ACTIVE',
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL,
      CONSTRAINT "StampProgram_pkey" PRIMARY KEY ("id")
  )`,
  `CREATE INDEX IF NOT EXISTS "StampProgram_campaignId_status_idx" ON "StampProgram"("campaignId","status")`,
  `CREATE INDEX IF NOT EXISTS "StampProgram_categoryId_idx" ON "StampProgram"("categoryId")`,

  `CREATE TABLE IF NOT EXISTS "StampCard" (
      "id" TEXT NOT NULL,
      "campaignId" TEXT NOT NULL,
      "programId" TEXT NOT NULL,
      "customerId" TEXT NOT NULL,
      "stampsCount" INTEGER NOT NULL DEFAULT 0,
      "cyclesCompleted" INTEGER NOT NULL DEFAULT 0,
      "lastStampAt" TIMESTAMP(3),
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL,
      CONSTRAINT "StampCard_pkey" PRIMARY KEY ("id")
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "StampCard_programId_customerId_key" ON "StampCard"("programId","customerId")`,
  `CREATE INDEX IF NOT EXISTS "StampCard_customerId_idx" ON "StampCard"("customerId")`,

  `CREATE TABLE IF NOT EXISTS "StampEvent" (
      "id" TEXT NOT NULL,
      "campaignId" TEXT NOT NULL,
      "programId" TEXT NOT NULL,
      "customerId" TEXT NOT NULL,
      "allyBusinessId" TEXT,
      "operatorUserId" TEXT,
      "action" "StampEventAction" NOT NULL,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "StampEvent_pkey" PRIMARY KEY ("id")
  )`,
  `CREATE INDEX IF NOT EXISTS "StampEvent_programId_customerId_createdAt_idx" ON "StampEvent"("programId","customerId","createdAt")`,
  `CREATE INDEX IF NOT EXISTS "StampEvent_allyBusinessId_createdAt_idx" ON "StampEvent"("allyBusinessId","createdAt")`,

  `DO $$ BEGIN ALTER TABLE "StampProgram" ADD CONSTRAINT "StampProgram_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "BenefitCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN null; END $$`,
  `DO $$ BEGIN ALTER TABLE "StampProgram" ADD CONSTRAINT "StampProgram_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "BenefitCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN null; END $$`,
  `DO $$ BEGIN ALTER TABLE "StampCard" ADD CONSTRAINT "StampCard_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "BenefitCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN null; END $$`,
  `DO $$ BEGIN ALTER TABLE "StampCard" ADD CONSTRAINT "StampCard_programId_fkey" FOREIGN KEY ("programId") REFERENCES "StampProgram"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN null; END $$`,
  `DO $$ BEGIN ALTER TABLE "StampCard" ADD CONSTRAINT "StampCard_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN null; END $$`,
  `DO $$ BEGIN ALTER TABLE "StampEvent" ADD CONSTRAINT "StampEvent_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "BenefitCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN null; END $$`,
  `DO $$ BEGIN ALTER TABLE "StampEvent" ADD CONSTRAINT "StampEvent_programId_fkey" FOREIGN KEY ("programId") REFERENCES "StampProgram"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN null; END $$`,
  `DO $$ BEGIN ALTER TABLE "StampEvent" ADD CONSTRAINT "StampEvent_allyBusinessId_fkey" FOREIGN KEY ("allyBusinessId") REFERENCES "AllyBusiness"("id") ON DELETE SET NULL ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN null; END $$`,
];

(async () => {
  const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
  if (!url) { console.error('No DATABASE_URL'); process.exit(1); }
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  for (const sql of STMTS) await prisma.$executeRawUnsafe(sql);
  console.log('✅ DDL Cuponera Fase 5 (sellos) aplicado (idempotente).');

  const name = '20260709020500_add_cuponera_stamps';
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
