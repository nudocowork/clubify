// Migración 20260820_tenant_reservations_whatsapp: agrega a Tenant el campo
// whatsappReservationsPhone (TEXT nullable) — WhatsApp donde el negocio recibe
// el aviso de cada reserva nueva. Idempotente. Correr ANTES de deployar.
// Usage: railway run --service Postgres-Nq8w node /ABS/PATH/backend/scripts/apply-reservations-whatsapp-migration.cjs
const { PrismaClient } = require('@prisma/client');
const crypto = require('crypto');

(async () => {
  const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
  if (!url) {
    console.error('No DATABASE_URL');
    process.exit(1);
  }
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  const name = '20260820_tenant_reservations_whatsapp';

  await prisma.$executeRawUnsafe(
    `ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "whatsappReservationsPhone" TEXT`,
  );
  console.log('✅ DDL aplicado (idempotente).');

  const exists = await prisma.$queryRawUnsafe(
    `SELECT 1 FROM "_prisma_migrations" WHERE migration_name = $1 LIMIT 1`,
    name,
  );
  if (!exists.length) {
    await prisma.$executeRawUnsafe(
      `INSERT INTO "_prisma_migrations" (id, checksum, migration_name, started_at, finished_at, applied_steps_count)
       VALUES ($1, $2, $3, now(), now(), 1)`,
      crypto.randomUUID(),
      'manual-apply',
      name,
    );
    console.log('✅ Registrada en _prisma_migrations.');
  } else {
    console.log('• Ya estaba registrada.');
  }

  await prisma.$disconnect();
  console.log('\nListo. Ahora deployá el backend.');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
