// Aplica la migration 20260612_reservation_stamp_granted_at a prod.
// Usage: railway run --service Postgres-Nq8w node scripts/apply-reservation-stamp-migration.cjs
const { PrismaClient } = require('@prisma/client');

const MIGRATION_NAME = '20260612_reservation_stamp_granted_at';

(async () => {
  const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
  if (!url) { console.error('No DATABASE_URL'); process.exit(1); }
  const prisma = new PrismaClient({ datasources: { db: { url } } });

  const col = await prisma.$queryRawUnsafe(
    `SELECT column_name FROM information_schema.columns
      WHERE table_schema='public' AND table_name='Reservation' AND column_name='stampGrantedAt'`,
  );
  if (col.length === 0) {
    await prisma.$executeRawUnsafe(`ALTER TABLE "Reservation" ADD COLUMN "stampGrantedAt" TIMESTAMP(3)`);
    console.log('✓ Reservation.stampGrantedAt creado');
  } else {
    console.log('✓ Reservation.stampGrantedAt ya existe');
  }

  const exists = await prisma.$queryRawUnsafe(
    `SELECT id FROM _prisma_migrations WHERE migration_name = $1`, MIGRATION_NAME,
  );
  if (exists.length === 0) {
    await prisma.$executeRawUnsafe(
      `INSERT INTO _prisma_migrations (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
       VALUES (gen_random_uuid()::text, 'manual-apply-' || extract(epoch from now())::text, NOW(), $1, NULL, NULL, NOW(), 1)`,
      MIGRATION_NAME,
    );
    console.log(`✓ Migration ${MIGRATION_NAME} marcada`);
  } else {
    console.log(`✓ Migration ${MIGRATION_NAME} ya marcada`);
  }

  await prisma.$disconnect();
  console.log('\n✅ Listo.');
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
