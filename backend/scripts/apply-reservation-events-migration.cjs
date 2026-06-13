// Aplica la migration 20260613_reservation_events a prod.
// Usage: railway run --service Postgres-Nq8w node scripts/apply-reservation-events-migration.cjs
const { PrismaClient } = require('@prisma/client');

const MIGRATION_NAME = '20260613_reservation_events';

(async () => {
  const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
  if (!url) { console.error('No DATABASE_URL'); process.exit(1); }
  const prisma = new PrismaClient({ datasources: { db: { url } } });

  // 1) Enums
  for (const [name, vals] of [
    ['EventStatus', ['DRAFT', 'PUBLISHED', 'CANCELLED', 'COMPLETED']],
    ['AttendeeStatus', ['CONFIRMED', 'CHECKED_IN', 'CANCELLED', 'NO_SHOW']],
  ]) {
    const exists = await prisma.$queryRawUnsafe(
      `SELECT typname FROM pg_type WHERE typname=$1`, name,
    );
    if (exists.length === 0) {
      const list = vals.map((v) => `'${v}'`).join(', ');
      await prisma.$executeRawUnsafe(`CREATE TYPE "${name}" AS ENUM (${list})`);
      console.log(`✓ Enum ${name} creado`);
    } else {
      console.log(`✓ Enum ${name} ya existe`);
    }
  }

  // 2) Tablas
  const tables = [
    {
      name: 'ReservationEvent',
      sql: `CREATE TABLE "ReservationEvent" (
        "id" TEXT NOT NULL,
        "tenantId" TEXT NOT NULL,
        "locationId" TEXT,
        "name" TEXT NOT NULL,
        "description" TEXT,
        "coverImageUrl" TEXT,
        "date" TIMESTAMP(3) NOT NULL,
        "startTime" TEXT NOT NULL,
        "endTime" TEXT NOT NULL,
        "capacity" INTEGER NOT NULL,
        "price" DECIMAL(12, 2),
        "priceCurrency" TEXT NOT NULL DEFAULT 'MXN',
        "status" "EventStatus" NOT NULL DEFAULT 'DRAFT',
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL,
        CONSTRAINT "ReservationEvent_pkey" PRIMARY KEY ("id")
      )`,
      indexes: [
        `CREATE INDEX "ReservationEvent_tenantId_date_status_idx" ON "ReservationEvent"("tenantId", "date", "status")`,
        `CREATE INDEX "ReservationEvent_locationId_idx" ON "ReservationEvent"("locationId")`,
      ],
      fks: [
        `ALTER TABLE "ReservationEvent" ADD CONSTRAINT "ReservationEvent_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE`,
        `ALTER TABLE "ReservationEvent" ADD CONSTRAINT "ReservationEvent_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE`,
      ],
    },
    {
      name: 'EventAttendee',
      sql: `CREATE TABLE "EventAttendee" (
        "id" TEXT NOT NULL,
        "tenantId" TEXT NOT NULL,
        "eventId" TEXT NOT NULL,
        "customerId" TEXT,
        "customerName" TEXT NOT NULL,
        "customerPhone" TEXT NOT NULL,
        "customerEmail" TEXT,
        "party" INTEGER NOT NULL DEFAULT 1,
        "notes" TEXT,
        "status" "AttendeeStatus" NOT NULL DEFAULT 'CONFIRMED',
        "checkInAt" TIMESTAMP(3),
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "EventAttendee_pkey" PRIMARY KEY ("id")
      )`,
      indexes: [
        `CREATE INDEX "EventAttendee_eventId_idx" ON "EventAttendee"("eventId")`,
        `CREATE INDEX "EventAttendee_tenantId_idx" ON "EventAttendee"("tenantId")`,
        `CREATE INDEX "EventAttendee_customerId_idx" ON "EventAttendee"("customerId")`,
      ],
      fks: [
        `ALTER TABLE "EventAttendee" ADD CONSTRAINT "EventAttendee_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE`,
        `ALTER TABLE "EventAttendee" ADD CONSTRAINT "EventAttendee_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "ReservationEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE`,
        `ALTER TABLE "EventAttendee" ADD CONSTRAINT "EventAttendee_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE`,
      ],
    },
  ];

  for (const t of tables) {
    const ex = await prisma.$queryRawUnsafe(
      `SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name=$1`,
      t.name,
    );
    if (ex.length === 0) {
      await prisma.$executeRawUnsafe(t.sql);
      for (const idx of t.indexes) await prisma.$executeRawUnsafe(idx);
      for (const fk of t.fks) await prisma.$executeRawUnsafe(fk);
      console.log(`✓ Tabla ${t.name} creada`);
    } else {
      console.log(`✓ Tabla ${t.name} ya existe`);
    }
  }

  // 3) Marcar migration
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
