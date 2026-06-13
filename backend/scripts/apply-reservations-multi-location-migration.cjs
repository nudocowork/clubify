// Aplica la migration 20260612_reservations_multi_location a prod.
// Usage: railway run --service Postgres-Nq8w node scripts/apply-reservations-multi-location-migration.cjs
const { PrismaClient } = require('@prisma/client');

const MIGRATION_NAME = '20260612_reservations_multi_location';

async function addColumn(prisma, table, column, type) {
  const col = await prisma.$queryRawUnsafe(
    `SELECT column_name FROM information_schema.columns
      WHERE table_schema='public' AND table_name=$1 AND column_name=$2`,
    table, column,
  );
  if (col.length === 0) {
    await prisma.$executeRawUnsafe(`ALTER TABLE "${table}" ADD COLUMN "${column}" ${type}`);
    console.log(`✓ ${table}.${column} creado`);
  } else {
    console.log(`✓ ${table}.${column} ya existe`);
  }
}

async function addIndex(prisma, name, sql) {
  const idx = await prisma.$queryRawUnsafe(
    `SELECT indexname FROM pg_indexes WHERE schemaname='public' AND indexname=$1`, name,
  );
  if (idx.length === 0) {
    await prisma.$executeRawUnsafe(sql);
    console.log(`✓ Index ${name} creado`);
  } else {
    console.log(`✓ Index ${name} ya existe`);
  }
}

async function addFk(prisma, table, name, sql) {
  const fk = await prisma.$queryRawUnsafe(
    `SELECT conname FROM pg_constraint WHERE conname=$1`, name,
  );
  if (fk.length === 0) {
    await prisma.$executeRawUnsafe(sql);
    console.log(`✓ FK ${name} creada`);
  } else {
    console.log(`✓ FK ${name} ya existe`);
  }
}

(async () => {
  const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
  if (!url) { console.error('No DATABASE_URL'); process.exit(1); }
  const prisma = new PrismaClient({ datasources: { db: { url } } });

  await addColumn(prisma, 'ReservationZone', 'locationId', 'TEXT');
  await addColumn(prisma, 'ReservationTable', 'locationId', 'TEXT');
  await addColumn(prisma, 'Reservation', 'locationId', 'TEXT');

  await addIndex(prisma, 'ReservationZone_locationId_idx',
    `CREATE INDEX "ReservationZone_locationId_idx" ON "ReservationZone"("locationId")`);
  await addIndex(prisma, 'ReservationTable_locationId_idx',
    `CREATE INDEX "ReservationTable_locationId_idx" ON "ReservationTable"("locationId")`);
  await addIndex(prisma, 'Reservation_locationId_date_idx',
    `CREATE INDEX "Reservation_locationId_date_idx" ON "Reservation"("locationId", "date")`);

  await addFk(prisma, 'ReservationZone', 'ReservationZone_locationId_fkey',
    `ALTER TABLE "ReservationZone" ADD CONSTRAINT "ReservationZone_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE`);
  await addFk(prisma, 'ReservationTable', 'ReservationTable_locationId_fkey',
    `ALTER TABLE "ReservationTable" ADD CONSTRAINT "ReservationTable_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE`);
  await addFk(prisma, 'Reservation', 'Reservation_locationId_fkey',
    `ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE`);

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
