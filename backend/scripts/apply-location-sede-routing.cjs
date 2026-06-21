// Apply migration 20260809_location_sede_routing. Agrega Location.state +
// Location.ordersWhatsappPhone (sedes por estado). Idempotente, aditivo.
// Usage (desde ~/Documents/AGENTES/CLUBIFY/backend):
//   railway run --service Postgres-Nq8w node scripts/apply-location-sede-routing.cjs
const { PrismaClient } = require('@prisma/client');
(async () => {
  const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
  if (!url) { console.error('ERROR: no DB url'); process.exit(1); }
  console.log('Connecting to:', url.replace(/:\/\/[^@]+@/, '://***:***@'));
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  console.log('Adding Location.state + Location.ordersWhatsappPhone…');
  await prisma.$executeRawUnsafe(`ALTER TABLE "Location" ADD COLUMN IF NOT EXISTS "state" TEXT`);
  await prisma.$executeRawUnsafe(`ALTER TABLE "Location" ADD COLUMN IF NOT EXISTS "ordersWhatsappPhone" TEXT`);
  const MIG = '20260809_location_sede_routing';
  const existing = await prisma.$queryRawUnsafe(`SELECT 1 FROM _prisma_migrations WHERE migration_name = '${MIG}' LIMIT 1`);
  if (!existing.length) {
    await prisma.$executeRawUnsafe(`INSERT INTO _prisma_migrations (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count) VALUES (gen_random_uuid()::text, 'manual-fix-2026-06-21', NOW(), '${MIG}', NULL, NULL, NOW(), 1)`);
  } else { console.log('  (already recorded — skip)'); }
  const cols = await prisma.$queryRawUnsafe(`SELECT column_name FROM information_schema.columns WHERE table_name='Location' AND column_name IN ('state','ordersWhatsappPhone') ORDER BY column_name`);
  console.log('Column check:', cols);
  await prisma.$disconnect();
  console.log('Done.');
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
