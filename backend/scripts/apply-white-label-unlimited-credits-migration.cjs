// Agrega WhiteLabel.creditsUnlimited (boolean, default false).
// Idempotente. Usage:
//   railway run --service Postgres-Nq8w node \
//     /Users/jhonarias/Documents/AGENTES/CLUBIFY/backend/scripts/apply-white-label-unlimited-credits-migration.cjs

const { PrismaClient } = require('@prisma/client');

const MIGRATION_NAME = '20260614_white_label_unlimited_credits';

(async () => {
  const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
  if (!url) { console.error('No DATABASE_URL'); process.exit(1); }
  const prisma = new PrismaClient({ datasources: { db: { url } } });

  const colCheck = await prisma.$queryRawUnsafe(
    `SELECT column_name FROM information_schema.columns WHERE table_name='WhiteLabel' AND column_name='creditsUnlimited'`,
  );
  if (colCheck.length === 0) {
    await prisma.$executeRawUnsafe(
      `ALTER TABLE "WhiteLabel" ADD COLUMN "creditsUnlimited" BOOLEAN NOT NULL DEFAULT false`,
    );
    console.log('✓ WhiteLabel.creditsUnlimited agregado');
  } else {
    console.log('✓ WhiteLabel.creditsUnlimited ya existía');
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
