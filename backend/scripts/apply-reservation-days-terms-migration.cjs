// Migración 20260801120000_add_reservation_days_terms: Tenant.reservationDays
// (días de la semana habilitados para reservas online, vacío=todos) +
// reservationTerms (observaciones/términos que ve el cliente antes de reservar).
// Aditiva e idempotente. Correr ANTES de deployar el backend:
//   railway run --service Postgres-Nq8w node scripts/apply-reservation-days-terms-migration.cjs
const { PrismaClient } = require('@prisma/client');
const crypto = require('crypto');
(async () => {
  const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
  if (!url) { console.error('No DATABASE_URL'); process.exit(1); }
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  const name = '20260801120000_add_reservation_days_terms';
  await prisma.$executeRawUnsafe(
    `ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "reservationDays" INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[]`,
  );
  await prisma.$executeRawUnsafe(
    `ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "reservationTerms" TEXT`,
  );
  console.log('✅ Columnas reservationDays/reservationTerms (idempotente).');
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
