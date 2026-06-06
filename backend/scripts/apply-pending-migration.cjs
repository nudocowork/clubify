// Apply pending migration 20260723_referral_code_default_vendor_commission_percent
// to production Postgres-Nq8w.
//
// Usage (from ~/Documents/AGENTES/CLUBIFY/backend):
//   railway run --service Postgres-Nq8w node scripts/apply-pending-migration.cjs
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

  console.log('Adding column…');
  await prisma.$executeRawUnsafe(
    `ALTER TABLE "ReferralCode" ADD COLUMN IF NOT EXISTS "defaultVendorCommissionPercent" DECIMAL(5, 2)`,
  );

  console.log('Recording migration in _prisma_migrations…');
  const existing = await prisma.$queryRawUnsafe(
    `SELECT 1 FROM _prisma_migrations
      WHERE migration_name = '20260723_referral_code_default_vendor_commission_percent'
      LIMIT 1`,
  );
  if (!existing.length) {
    await prisma.$executeRawUnsafe(
      `INSERT INTO _prisma_migrations
         (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
       VALUES
         (gen_random_uuid()::text,
          'manual-fix-2026-06-06',
          NOW(),
          '20260723_referral_code_default_vendor_commission_percent',
          NULL,
          NULL,
          NOW(),
          1)`,
    );
  } else {
    console.log('  (already recorded — skip)');
  }

  const colCheck = await prisma.$queryRawUnsafe(
    `SELECT column_name, data_type, numeric_precision, numeric_scale, is_nullable
       FROM information_schema.columns
      WHERE table_name = 'ReferralCode'
        AND column_name = 'defaultVendorCommissionPercent'`,
  );
  console.log('Column check:', colCheck);

  const migCheck = await prisma.$queryRawUnsafe(
    `SELECT migration_name, finished_at
       FROM _prisma_migrations
      WHERE migration_name = '20260723_referral_code_default_vendor_commission_percent'`,
  );
  console.log('Migration record:', migCheck);

  await prisma.$disconnect();
  console.log('Done.');
})().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});
