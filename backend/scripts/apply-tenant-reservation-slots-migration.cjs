// Aplica la migration 20260613_tenant_reservation_slots a prod.
// Usage: railway run --service Postgres-Nq8w node scripts/apply-tenant-reservation-slots-migration.cjs
const { PrismaClient } = require('@prisma/client');

const MIGRATION_NAME = '20260613_tenant_reservation_slots';

(async () => {
  const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
  if (!url) { console.error('No DATABASE_URL'); process.exit(1); }
  const prisma = new PrismaClient({ datasources: { db: { url } } });

  const col = await prisma.$queryRawUnsafe(
    `SELECT column_name FROM information_schema.columns
      WHERE table_schema='public' AND table_name='Tenant' AND column_name='reservationSlots'`,
  );
  if (col.length === 0) {
    await prisma.$executeRawUnsafe(
      `ALTER TABLE "Tenant" ADD COLUMN "reservationSlots" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[]`,
    );
    console.log('✓ Tenant.reservationSlots creado');
  } else {
    console.log('✓ Tenant.reservationSlots ya existe');
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
