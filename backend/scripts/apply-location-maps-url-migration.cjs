// #20 (2026-06-17): agrega Location.mapsUrl (TEXT, nullable) — link exacto de
// Google Maps por sucursal. Idempotente. Usage:
//   railway run --service Postgres-Nq8w node \
//     /Users/jhonarias/Documents/AGENTES/CLUBIFY/backend/scripts/apply-location-maps-url-migration.cjs
const { PrismaClient } = require('@prisma/client');
const MIGRATION_NAME = '20260801_location_maps_url';
(async () => {
  const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
  if (!url) { console.error('No DATABASE_URL'); process.exit(1); }
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  const col = await prisma.$queryRawUnsafe(
    `SELECT column_name FROM information_schema.columns WHERE table_name='Location' AND column_name='mapsUrl'`,
  );
  if (col.length === 0) {
    await prisma.$executeRawUnsafe(`ALTER TABLE "Location" ADD COLUMN "mapsUrl" TEXT`);
    console.log('✓ Location.mapsUrl agregado');
  } else {
    console.log('✓ Location.mapsUrl ya existía');
  }
  const mig = await prisma.$queryRawUnsafe(
    `SELECT id FROM "_prisma_migrations" WHERE migration_name = $1`, MIGRATION_NAME,
  );
  if (mig.length === 0) {
    await prisma.$executeRawUnsafe(
      `INSERT INTO "_prisma_migrations" (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
       VALUES (gen_random_uuid()::text, 'manual', now(), $1, NULL, NULL, now(), 1)`, MIGRATION_NAME,
    );
    console.log('✓ Registrado en _prisma_migrations');
  } else {
    console.log('✓ Ya estaba registrado');
  }
  await prisma.$disconnect();
  process.exit(0);
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });
