// Apply migration 20260807_business_groups a producción Postgres-Nq8w.
// Crea la tabla BusinessGroup + enum + Tenant.businessGroupId. Idempotente.
//
// Usage (desde ~/Documents/AGENTES/CLUBIFY/backend):
//   railway run --service Postgres-Nq8w node scripts/apply-business-groups.cjs
//
// IMPORTANTE: correr ANTES de deployar el backend nuevo.

const { PrismaClient } = require('@prisma/client');

(async () => {
  const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
  if (!url) {
    console.error('ERROR: no DATABASE_PUBLIC_URL nor DATABASE_URL in env');
    process.exit(1);
  }
  console.log('Connecting to:', url.replace(/:\/\/[^@]+@/, '://***:***@'));
  const prisma = new PrismaClient({ datasources: { db: { url } } });

  console.log('Creating enum BusinessGroupStatus…');
  await prisma.$executeRawUnsafe(`DO $$ BEGIN
    CREATE TYPE "BusinessGroupStatus" AS ENUM ('ACTIVE', 'PAST_DUE', 'SUSPENDED');
  EXCEPTION WHEN duplicate_object THEN null; END $$;`);

  console.log('Creating table BusinessGroup…');
  await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "BusinessGroup" (
    "id" TEXT NOT NULL,
    "whiteLabelId" TEXT,
    "name" TEXT NOT NULL,
    "responsibleName" TEXT,
    "responsibleEmail" TEXT,
    "responsiblePhone" TEXT,
    "hotmartSubscriberCode" TEXT,
    "planPeriodicity" TEXT,
    "currentPeriodEnd" TIMESTAMP(3),
    "status" "BusinessGroupStatus" NOT NULL DEFAULT 'ACTIVE',
    "failedPaymentCount" INTEGER NOT NULL DEFAULT 0,
    "suspendedAt" TIMESTAMP(3),
    "lastChargeAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),
    CONSTRAINT "BusinessGroup_pkey" PRIMARY KEY ("id")
  );`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "BusinessGroup_whiteLabelId_idx" ON "BusinessGroup"("whiteLabelId");`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "BusinessGroup_hotmartSubscriberCode_idx" ON "BusinessGroup"("hotmartSubscriberCode");`);
  await prisma.$executeRawUnsafe(`DO $$ BEGIN
    ALTER TABLE "BusinessGroup" ADD CONSTRAINT "BusinessGroup_whiteLabelId_fkey"
      FOREIGN KEY ("whiteLabelId") REFERENCES "WhiteLabel"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  EXCEPTION WHEN duplicate_object THEN null; END $$;`);

  console.log('Adding Tenant.businessGroupId…');
  await prisma.$executeRawUnsafe(`ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "businessGroupId" TEXT;`);
  await prisma.$executeRawUnsafe(`DO $$ BEGIN
    ALTER TABLE "Tenant" ADD CONSTRAINT "Tenant_businessGroupId_fkey"
      FOREIGN KEY ("businessGroupId") REFERENCES "BusinessGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  EXCEPTION WHEN duplicate_object THEN null; END $$;`);

  const MIG = '20260807_business_groups';
  const existing = await prisma.$queryRawUnsafe(
    `SELECT 1 FROM _prisma_migrations WHERE migration_name = '${MIG}' LIMIT 1`,
  );
  if (!existing.length) {
    await prisma.$executeRawUnsafe(
      `INSERT INTO _prisma_migrations
         (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
       VALUES (gen_random_uuid()::text, 'manual-fix-2026-06-19', NOW(), '${MIG}', NULL, NULL, NOW(), 1)`,
    );
  } else {
    console.log('  (migration already recorded — skip)');
  }

  const check = await prisma.$queryRawUnsafe(
    `SELECT table_name FROM information_schema.tables WHERE table_name = 'BusinessGroup'`,
  );
  console.log('Table check:', check);
  await prisma.$disconnect();
  console.log('Done.');
})().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});
