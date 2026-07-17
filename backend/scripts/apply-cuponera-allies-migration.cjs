// Migraciones Cuponera Fase 2 (negocios aliados):
//   20260709020200_add_ally_business_role  → enum Role += ALLY_BUSINESS
//   20260709020300_add_cuponera_allies      → AllyStatus + User.allyBusinessId
//     + tabla AllyBusiness + FKs.
// Idempotente. Correr ANTES de deployar (el startCommand no corre migrate
// deploy fiable). Requiere que la migración de Fase 1 ya esté aplicada.
//   node scripts/apply-cuponera-allies-migration.cjs
const { PrismaClient } = require('@prisma/client');
const crypto = require('crypto');

const STMTS = [
  `ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'ALLY_BUSINESS'`,
  `DO $$ BEGIN CREATE TYPE "AllyStatus" AS ENUM ('PENDING','APPROVED','REJECTED','SUSPENDED'); EXCEPTION WHEN duplicate_object THEN null; END $$`,
  `ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "allyBusinessId" TEXT`,
  `CREATE TABLE IF NOT EXISTS "AllyBusiness" (
      "id" TEXT NOT NULL,
      "campaignId" TEXT NOT NULL,
      "categoryId" TEXT,
      "name" TEXT NOT NULL,
      "slug" TEXT NOT NULL,
      "description" TEXT NOT NULL DEFAULT '',
      "logoUrl" TEXT,
      "coverUrl" TEXT,
      "photos" JSONB NOT NULL DEFAULT '[]',
      "address" TEXT NOT NULL DEFAULT '',
      "city" TEXT NOT NULL DEFAULT '',
      "latitude" DECIMAL(10,7),
      "longitude" DECIMAL(10,7),
      "hours" JSONB NOT NULL DEFAULT '{}',
      "whatsapp" TEXT,
      "instagram" TEXT,
      "website" TEXT,
      "status" "AllyStatus" NOT NULL DEFAULT 'PENDING',
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL,
      CONSTRAINT "AllyBusiness_pkey" PRIMARY KEY ("id")
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "AllyBusiness_slug_key" ON "AllyBusiness"("slug")`,
  `CREATE INDEX IF NOT EXISTS "AllyBusiness_campaignId_status_idx" ON "AllyBusiness"("campaignId","status")`,
  `CREATE INDEX IF NOT EXISTS "AllyBusiness_categoryId_idx" ON "AllyBusiness"("categoryId")`,
  `CREATE INDEX IF NOT EXISTS "User_allyBusinessId_idx" ON "User"("allyBusinessId")`,
  `DO $$ BEGIN ALTER TABLE "AllyBusiness" ADD CONSTRAINT "AllyBusiness_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "BenefitCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN null; END $$`,
  `DO $$ BEGIN ALTER TABLE "AllyBusiness" ADD CONSTRAINT "AllyBusiness_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "BenefitCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN null; END $$`,
  `DO $$ BEGIN ALTER TABLE "User" ADD CONSTRAINT "User_allyBusinessId_fkey" FOREIGN KEY ("allyBusinessId") REFERENCES "AllyBusiness"("id") ON DELETE SET NULL ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN null; END $$`,
];

(async () => {
  const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
  if (!url) { console.error('No DATABASE_URL'); process.exit(1); }
  const prisma = new PrismaClient({ datasources: { db: { url } } });

  for (const sql of STMTS) {
    await prisma.$executeRawUnsafe(sql);
  }
  console.log('✅ DDL Cuponera Fase 2 (aliados) aplicado (idempotente).');

  for (const name of ['20260709020200_add_ally_business_role', '20260709020300_add_cuponera_allies']) {
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
  }
  await prisma.$disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
