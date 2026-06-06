// Apply pending migration 20260606_pending_hotmart_payment to production
// Postgres-Nq8w. Crea la tabla PendingHotmartPayment (flujo "pago → datos").
//
// Usage (from ~/Documents/AGENTES/CLUBIFY/backend):
//   railway run --service Postgres-Nq8w node scripts/apply-pending-hotmart-payment-migration.cjs
//
// Reads DATABASE_PUBLIC_URL (or DATABASE_URL) from Railway-injected env.
// Idempotente: usa IF NOT EXISTS y SELECT-then-INSERT en _prisma_migrations.

const { PrismaClient } = require('@prisma/client');

const MIGRATION = '20260606_pending_hotmart_payment';

(async () => {
  const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
  if (!url) {
    console.error('ERROR: no DATABASE_PUBLIC_URL nor DATABASE_URL in env');
    process.exit(1);
  }
  const masked = url.replace(/:\/\/[^@]+@/, '://***:***@');
  console.log('Connecting to:', masked);

  const prisma = new PrismaClient({ datasources: { db: { url } } });

  console.log('Creating table PendingHotmartPayment…');
  await prisma.$executeRawUnsafe(
    `CREATE TABLE IF NOT EXISTS "PendingHotmartPayment" (
       "id" TEXT NOT NULL,
       "email" TEXT NOT NULL,
       "subscriberCode" TEXT,
       "transactionId" TEXT,
       "event" TEXT NOT NULL,
       "rawPayload" JSONB NOT NULL,
       "consumedAt" TIMESTAMP(3),
       "recoveryNotifiedAt" TIMESTAMP(3),
       "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
       "updatedAt" TIMESTAMP(3) NOT NULL,
       CONSTRAINT "PendingHotmartPayment_pkey" PRIMARY KEY ("id")
     )`,
  );

  console.log('Creating indices…');
  await prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS "PendingHotmartPayment_email_idx" ON "PendingHotmartPayment"("email")`,
  );
  await prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS "PendingHotmartPayment_consumedAt_idx" ON "PendingHotmartPayment"("consumedAt")`,
  );

  console.log('Recording migration in _prisma_migrations…');
  const existing = await prisma.$queryRawUnsafe(
    `SELECT 1 FROM _prisma_migrations WHERE migration_name = '${MIGRATION}' LIMIT 1`,
  );
  if (!existing.length) {
    await prisma.$executeRawUnsafe(
      `INSERT INTO _prisma_migrations
         (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
       VALUES
         (gen_random_uuid()::text,
          'manual-fix-2026-06-06',
          NOW(),
          '${MIGRATION}',
          NULL,
          NULL,
          NOW(),
          1)`,
    );
  } else {
    console.log('  (already recorded — skip)');
  }

  const tableCheck = await prisma.$queryRawUnsafe(
    `SELECT column_name, data_type FROM information_schema.columns
      WHERE table_name = 'PendingHotmartPayment' ORDER BY ordinal_position`,
  );
  console.log('Table columns:', tableCheck);

  const migCheck = await prisma.$queryRawUnsafe(
    `SELECT migration_name, finished_at FROM _prisma_migrations WHERE migration_name = '${MIGRATION}'`,
  );
  console.log('Migration record:', migCheck);

  await prisma.$disconnect();
  console.log('Done.');
})().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});
