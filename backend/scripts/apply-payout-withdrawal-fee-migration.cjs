// Agrega CommissionPayout.feeUsd (default 0) + netUsd (nullable) — costo de
// retiro. Idempotente. Usage:
//   railway run --service Postgres-Nq8w node \
//     /Users/jhonarias/Documents/AGENTES/CLUBIFY/backend/scripts/apply-payout-withdrawal-fee-migration.cjs

const { PrismaClient } = require('@prisma/client');

const MIGRATION_NAME = '20260728_payout_withdrawal_fee';

(async () => {
  const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
  if (!url) { console.error('No DATABASE_URL'); process.exit(1); }
  const prisma = new PrismaClient({ datasources: { db: { url } } });

  const cols = await prisma.$queryRawUnsafe(
    `SELECT column_name FROM information_schema.columns WHERE table_name='CommissionPayout' AND column_name IN ('feeUsd','netUsd')`,
  );
  const have = new Set(cols.map((c) => c.column_name));
  if (!have.has('feeUsd')) {
    await prisma.$executeRawUnsafe(
      `ALTER TABLE "CommissionPayout" ADD COLUMN "feeUsd" DECIMAL(10, 2) NOT NULL DEFAULT 0`,
    );
    console.log('✓ CommissionPayout.feeUsd agregado');
  } else {
    console.log('✓ CommissionPayout.feeUsd ya existía');
  }
  if (!have.has('netUsd')) {
    await prisma.$executeRawUnsafe(
      `ALTER TABLE "CommissionPayout" ADD COLUMN "netUsd" DECIMAL(10, 2)`,
    );
    console.log('✓ CommissionPayout.netUsd agregado');
  } else {
    console.log('✓ CommissionPayout.netUsd ya existía');
  }

  const existing = await prisma.$queryRawUnsafe(
    `SELECT id FROM "_prisma_migrations" WHERE migration_name = $1`,
    MIGRATION_NAME,
  );
  if (existing.length === 0) {
    await prisma.$executeRawUnsafe(
      `INSERT INTO "_prisma_migrations" (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
       VALUES (gen_random_uuid()::text, 'manual', now(), $1, NULL, NULL, now(), 1)`,
      MIGRATION_NAME,
    );
    console.log('✓ Registrado en _prisma_migrations');
  } else {
    console.log('✓ Ya estaba registrado en _prisma_migrations');
  }

  console.log('\nDone.');
  process.exit(0);
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
