// Agrega Tenant.currencySymbol (nullable) + Tenant.country (default "CO").
// Idempotente. Usage:
//   railway run --service Postgres-Nq8w node \
//     /Users/jhonarias/Documents/AGENTES/CLUBIFY/backend/scripts/apply-tenant-currency-country-migration.cjs

const { PrismaClient } = require('@prisma/client');

const MIGRATION_NAME = '20260614_tenant_currency_country';

(async () => {
  const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
  if (!url) { console.error('No DATABASE_URL'); process.exit(1); }
  const prisma = new PrismaClient({ datasources: { db: { url } } });

  const cs = await prisma.$queryRawUnsafe(
    `SELECT column_name FROM information_schema.columns WHERE table_name='Tenant' AND column_name='currencySymbol'`,
  );
  if (cs.length === 0) {
    await prisma.$executeRawUnsafe(`ALTER TABLE "Tenant" ADD COLUMN "currencySymbol" TEXT`);
    console.log('✓ Tenant.currencySymbol agregado');
  } else {
    console.log('✓ Tenant.currencySymbol ya existía');
  }

  const co = await prisma.$queryRawUnsafe(
    `SELECT column_name FROM information_schema.columns WHERE table_name='Tenant' AND column_name='country'`,
  );
  if (co.length === 0) {
    await prisma.$executeRawUnsafe(`ALTER TABLE "Tenant" ADD COLUMN "country" TEXT NOT NULL DEFAULT 'CO'`);
    console.log('✓ Tenant.country agregado (default CO)');
  } else {
    console.log('✓ Tenant.country ya existía');
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
