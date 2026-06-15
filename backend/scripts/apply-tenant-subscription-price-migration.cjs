// Agrega Tenant.subscriptionPriceUsd (nullable DECIMAL(10,2)) — precio REAL
// pagado en Hotmart, base de comisiones. Idempotente. Usage:
//   railway run --service Postgres-Nq8w node \
//     /Users/jhonarias/Documents/AGENTES/CLUBIFY/backend/scripts/apply-tenant-subscription-price-migration.cjs

const { PrismaClient } = require('@prisma/client');

const MIGRATION_NAME = '20260727_tenant_subscription_price';

(async () => {
  const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
  if (!url) { console.error('No DATABASE_URL'); process.exit(1); }
  const prisma = new PrismaClient({ datasources: { db: { url } } });

  const col = await prisma.$queryRawUnsafe(
    `SELECT column_name FROM information_schema.columns WHERE table_name='Tenant' AND column_name='subscriptionPriceUsd'`,
  );
  if (col.length === 0) {
    await prisma.$executeRawUnsafe(
      `ALTER TABLE "Tenant" ADD COLUMN "subscriptionPriceUsd" DECIMAL(10, 2)`,
    );
    console.log('✓ Tenant.subscriptionPriceUsd agregado');
  } else {
    console.log('✓ Tenant.subscriptionPriceUsd ya existía');
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
})().catch((e) => {
  console.error('FAIL', e);
  process.exit(1);
});
