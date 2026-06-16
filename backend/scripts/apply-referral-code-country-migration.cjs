// Apply pending migration 20260731_referral_code_country
// to production Postgres-Nq8w.
//
// Usage (from ~/Documents/AGENTES/CLUBIFY/backend):
//   railway run --service Postgres-Nq8w node /Users/jhonarias/Documents/AGENTES/CLUBIFY/backend/scripts/apply-referral-code-country-migration.cjs
//
// Reads DATABASE_PUBLIC_URL (or DATABASE_URL) from Railway-injected env.

const { PrismaClient } = require('@prisma/client');

(async () => {
  const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
  if (!url) {
    console.error('ERROR: no DATABASE_PUBLIC_URL nor DATABASE_URL in env');
    process.exit(1);
  }
  const masked = url.replace(/:\/\/[^@]+@/, '://***:***@');
  console.log('Connecting to:', masked);

  const prisma = new PrismaClient({
    datasources: { db: { url } },
  });

  console.log('Adding column "country" to ReferralCode…');
  await prisma.$executeRawUnsafe(
    `ALTER TABLE "ReferralCode" ADD COLUMN IF NOT EXISTS "country" TEXT`,
  );

  console.log('Recording migration in _prisma_migrations…');
  const existing = await prisma.$queryRawUnsafe(
    `SELECT 1 FROM _prisma_migrations
      WHERE migration_name = '20260731_referral_code_country'
      LIMIT 1`,
  );
  if (!existing.length) {
    await prisma.$executeRawUnsafe(
      `INSERT INTO _prisma_migrations
         (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
       VALUES
         (gen_random_uuid()::text,
          'manual-fix-2026-06-16',
          NOW(),
          '20260731_referral_code_country',
          NULL,
          NULL,
          NOW(),
          1)`,
    );
  } else {
    console.log('  (already recorded — skip)');
  }

  const colCheck = await prisma.$queryRawUnsafe(
    `SELECT column_name, data_type, is_nullable
       FROM information_schema.columns
      WHERE table_name = 'ReferralCode'
        AND column_name = 'country'`,
  );
  console.log('Column check:', colCheck);

  await prisma.$disconnect();
  console.log('Done.');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
