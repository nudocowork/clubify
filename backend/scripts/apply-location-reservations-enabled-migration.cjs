// Migración 20260801150000_add_location_reservations_enabled: Location.reservationsEnabled
// (por sede: si false, la sede no aparece en el flujo público de reservas).
// Aditiva e idempotente. Correr ANTES de deployar el backend:
//   railway run --service Postgres-Nq8w node scripts/apply-location-reservations-enabled-migration.cjs
const { PrismaClient } = require('@prisma/client');
const crypto = require('crypto');
(async () => {
  const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
  if (!url) { console.error('No DATABASE_URL'); process.exit(1); }
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  const name = '20260801150000_add_location_reservations_enabled';
  await prisma.$executeRawUnsafe(
    `ALTER TABLE "Location" ADD COLUMN IF NOT EXISTS "reservationsEnabled" BOOLEAN NOT NULL DEFAULT true`,
  );
  console.log('✅ Columna Location.reservationsEnabled (idempotente).');
  const exists = await prisma.$queryRawUnsafe(
    `SELECT 1 FROM "_prisma_migrations" WHERE migration_name = $1 LIMIT 1`, name,
  );
  if (!exists.length) {
    await prisma.$executeRawUnsafe(
      `INSERT INTO "_prisma_migrations" (id, checksum, migration_name, started_at, finished_at, applied_steps_count)
       VALUES ($1, $2, $3, now(), now(), 1)`,
      crypto.randomUUID(), 'manual-apply', name,
    );
    console.log('✅ Registrada en _prisma_migrations.');
  } else { console.log('• Ya estaba registrada.'); }
  await prisma.$disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
