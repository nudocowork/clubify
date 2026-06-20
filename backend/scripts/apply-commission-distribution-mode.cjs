// Apply migration 20260808_commission_distribution_mode a producción Postgres-Nq8w.
// Fase 3/4/7 overhaul comisiones: enum CommissionDistributionMode + valor
// ADJUSTMENT en CommissionStatus + Tenant.commissionDistributionMode +
// snapshot en Commission (distributionMode/baseAmountUsd/appliedPercent).
// Idempotente. SOLO agrega — NO toca datos ni comisiones históricas.
//
// Usage (desde ~/Documents/AGENTES/CLUBIFY/backend):
//   railway run --service Postgres-Nq8w node scripts/apply-commission-distribution-mode.cjs
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

  console.log('Creating enum CommissionDistributionMode…');
  await prisma.$executeRawUnsafe(`DO $$ BEGIN
    CREATE TYPE "CommissionDistributionMode" AS ENUM ('DISCOUNT_FROM_INFLUENCER', 'ADDITIONAL_COMPANY_COMMISSION');
  EXCEPTION WHEN duplicate_object THEN null; END $$;`);

  console.log('Adding ADJUSTMENT to CommissionStatus…');
  // ALTER TYPE ADD VALUE no puede ir dentro de un bloque de transacción; va suelto.
  await prisma.$executeRawUnsafe(
    `ALTER TYPE "CommissionStatus" ADD VALUE IF NOT EXISTS 'ADJUSTMENT'`,
  );

  console.log('Adding Tenant.commissionDistributionMode…');
  await prisma.$executeRawUnsafe(
    `ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "commissionDistributionMode" "CommissionDistributionMode" NOT NULL DEFAULT 'DISCOUNT_FROM_INFLUENCER'`,
  );

  console.log('Adding snapshot columns to Commission…');
  await prisma.$executeRawUnsafe(
    `ALTER TABLE "Commission" ADD COLUMN IF NOT EXISTS "distributionMode" "CommissionDistributionMode"`,
  );
  await prisma.$executeRawUnsafe(
    `ALTER TABLE "Commission" ADD COLUMN IF NOT EXISTS "baseAmountUsd" DECIMAL(10,2)`,
  );
  await prisma.$executeRawUnsafe(
    `ALTER TABLE "Commission" ADD COLUMN IF NOT EXISTS "appliedPercent" DECIMAL(5,2)`,
  );

  const MIG = '20260808_commission_distribution_mode';
  const existing = await prisma.$queryRawUnsafe(
    `SELECT 1 FROM _prisma_migrations WHERE migration_name = '${MIG}' LIMIT 1`,
  );
  if (!existing.length) {
    await prisma.$executeRawUnsafe(
      `INSERT INTO _prisma_migrations
         (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
       VALUES (gen_random_uuid()::text, 'manual-fix-2026-06-20', NOW(), '${MIG}', NULL, NULL, NOW(), 1)`,
    );
  } else {
    console.log('  (migration already recorded — skip)');
  }

  const cols = await prisma.$queryRawUnsafe(
    `SELECT column_name FROM information_schema.columns
      WHERE (table_name='Tenant' AND column_name='commissionDistributionMode')
         OR (table_name='Commission' AND column_name IN ('distributionMode','baseAmountUsd','appliedPercent'))
      ORDER BY column_name`,
  );
  console.log('Column check:', cols);
  await prisma.$disconnect();
  console.log('Done.');
})().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});
