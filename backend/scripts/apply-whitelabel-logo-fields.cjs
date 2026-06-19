// Apply migration 20260806_whitelabel_logo_fields to production Postgres-Nq8w.
// Agrega WhiteLabel.iconUrl (logo dashboard cuadrado) y WhiteLabel.faviconUrl
// (favicon por marca). Idempotente (ADD COLUMN IF NOT EXISTS).
//
// Usage (desde ~/Documents/AGENTES/CLUBIFY/backend):
//   railway run --service Postgres-Nq8w node scripts/apply-whitelabel-logo-fields.cjs
//
// IMPORTANTE: correr ANTES de deployar el backend nuevo (el código selecciona
// estas columnas; si no existen → error en /branding).

const { PrismaClient } = require('@prisma/client');

(async () => {
  const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
  if (!url) {
    console.error('ERROR: no DATABASE_PUBLIC_URL nor DATABASE_URL in env');
    process.exit(1);
  }
  const masked = url.replace(/:\/\/[^@]+@/, '://***:***@');
  console.log('Connecting to:', masked);

  const prisma = new PrismaClient({ datasources: { db: { url } } });

  console.log('Adding columns…');
  await prisma.$executeRawUnsafe(
    `ALTER TABLE "WhiteLabel" ADD COLUMN IF NOT EXISTS "iconUrl" TEXT`,
  );
  await prisma.$executeRawUnsafe(
    `ALTER TABLE "WhiteLabel" ADD COLUMN IF NOT EXISTS "faviconUrl" TEXT`,
  );

  const MIG = '20260806_whitelabel_logo_fields';
  console.log('Recording migration in _prisma_migrations…');
  const existing = await prisma.$queryRawUnsafe(
    `SELECT 1 FROM _prisma_migrations WHERE migration_name = '${MIG}' LIMIT 1`,
  );
  if (!existing.length) {
    await prisma.$executeRawUnsafe(
      `INSERT INTO _prisma_migrations
         (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
       VALUES
         (gen_random_uuid()::text, 'manual-fix-2026-06-19', NOW(), '${MIG}', NULL, NULL, NOW(), 1)`,
    );
  } else {
    console.log('  (already recorded — skip)');
  }

  const colCheck = await prisma.$queryRawUnsafe(
    `SELECT column_name FROM information_schema.columns
      WHERE table_name = 'WhiteLabel' AND column_name IN ('iconUrl','faviconUrl')
      ORDER BY column_name`,
  );
  console.log('Column check:', colCheck);

  await prisma.$disconnect();
  console.log('Done.');
})().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});
