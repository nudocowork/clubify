// Aplica la migration 20260612_reservations a prod.
// Usage: railway run --service Postgres-Nq8w node scripts/apply-reservations-migration.cjs
const { PrismaClient } = require('@prisma/client');

const MIGRATION_NAME = '20260612_reservations';

(async () => {
  const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
  if (!url) { console.error('No DATABASE_URL'); process.exit(1); }
  const prisma = new PrismaClient({ datasources: { db: { url } } });

  // 1) Tenant.reservationsEnabled
  const col = await prisma.$queryRawUnsafe(
    `SELECT column_name FROM information_schema.columns
      WHERE table_schema='public' AND table_name='Tenant' AND column_name='reservationsEnabled'`,
  );
  if (col.length === 0) {
    await prisma.$executeRawUnsafe(`ALTER TABLE "Tenant" ADD COLUMN "reservationsEnabled" BOOLEAN NOT NULL DEFAULT false`);
    console.log('✓ Tenant.reservationsEnabled creado');
  } else {
    console.log('✓ Tenant.reservationsEnabled ya existe');
  }

  // 2) Enums
  for (const [name, vals] of [
    ['ReservationStatus', ['PENDING','CONFIRMED','SEATED','COMPLETED','CANCELLED','NO_SHOW']],
    ['ReservationChannel', ['WEB','WHATSAPP','PHONE','QR','IN_PERSON']],
  ]) {
    const exists = await prisma.$queryRawUnsafe(
      `SELECT typname FROM pg_type WHERE typname=$1`, name,
    );
    if (exists.length === 0) {
      const list = vals.map(v => `'${v}'`).join(', ');
      await prisma.$executeRawUnsafe(`CREATE TYPE "${name}" AS ENUM (${list})`);
      console.log(`✓ Enum ${name} creado`);
    } else {
      console.log(`✓ Enum ${name} ya existe`);
    }
  }

  // 3) Tables (zone, table, reservation)
  const tablesToCreate = [
    {
      name: 'ReservationZone',
      sql: `CREATE TABLE "ReservationZone" (
        "id" TEXT NOT NULL,
        "tenantId" TEXT NOT NULL,
        "name" TEXT NOT NULL,
        "slug" TEXT NOT NULL,
        "type" TEXT NOT NULL DEFAULT 'INDOOR',
        "position" INTEGER NOT NULL DEFAULT 0,
        "isActive" BOOLEAN NOT NULL DEFAULT true,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "ReservationZone_pkey" PRIMARY KEY ("id")
      )`,
      indexes: [
        `CREATE UNIQUE INDEX "ReservationZone_tenantId_slug_key" ON "ReservationZone"("tenantId", "slug")`,
        `CREATE INDEX "ReservationZone_tenantId_isActive_idx" ON "ReservationZone"("tenantId", "isActive")`,
      ],
      fks: [
        `ALTER TABLE "ReservationZone" ADD CONSTRAINT "ReservationZone_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE`,
      ],
    },
    {
      name: 'ReservationTable',
      sql: `CREATE TABLE "ReservationTable" (
        "id" TEXT NOT NULL,
        "tenantId" TEXT NOT NULL,
        "zoneId" TEXT,
        "number" TEXT NOT NULL,
        "seats" INTEGER NOT NULL DEFAULT 4,
        "shape" TEXT NOT NULL DEFAULT 'ROUND',
        "posX" INTEGER NOT NULL DEFAULT 0,
        "posY" INTEGER NOT NULL DEFAULT 0,
        "width" INTEGER,
        "height" INTEGER,
        "isBlocked" BOOLEAN NOT NULL DEFAULT false,
        "isActive" BOOLEAN NOT NULL DEFAULT true,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "ReservationTable_pkey" PRIMARY KEY ("id")
      )`,
      indexes: [
        `CREATE INDEX "ReservationTable_tenantId_isActive_idx" ON "ReservationTable"("tenantId", "isActive")`,
        `CREATE INDEX "ReservationTable_zoneId_idx" ON "ReservationTable"("zoneId")`,
      ],
      fks: [
        `ALTER TABLE "ReservationTable" ADD CONSTRAINT "ReservationTable_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE`,
        `ALTER TABLE "ReservationTable" ADD CONSTRAINT "ReservationTable_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "ReservationZone"("id") ON DELETE SET NULL ON UPDATE CASCADE`,
      ],
    },
    {
      name: 'Reservation',
      sql: `CREATE TABLE "Reservation" (
        "id" TEXT NOT NULL,
        "tenantId" TEXT NOT NULL,
        "zoneId" TEXT,
        "tableId" TEXT,
        "customerId" TEXT,
        "customerName" TEXT NOT NULL,
        "customerPhone" TEXT NOT NULL,
        "customerEmail" TEXT,
        "party" INTEGER NOT NULL,
        "date" TIMESTAMP(3) NOT NULL,
        "time" TEXT NOT NULL,
        "notes" TEXT,
        "status" "ReservationStatus" NOT NULL DEFAULT 'PENDING',
        "channel" "ReservationChannel" NOT NULL DEFAULT 'WEB',
        "confirmedAt" TIMESTAMP(3),
        "seatedAt" TIMESTAMP(3),
        "completedAt" TIMESTAMP(3),
        "cancelledAt" TIMESTAMP(3),
        "notifiedAt" TIMESTAMP(3),
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL,
        CONSTRAINT "Reservation_pkey" PRIMARY KEY ("id")
      )`,
      indexes: [
        `CREATE INDEX "Reservation_tenantId_date_status_idx" ON "Reservation"("tenantId", "date", "status")`,
        `CREATE INDEX "Reservation_tableId_idx" ON "Reservation"("tableId")`,
        `CREATE INDEX "Reservation_customerId_idx" ON "Reservation"("customerId")`,
      ],
      fks: [
        `ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE`,
        `ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "ReservationZone"("id") ON DELETE SET NULL ON UPDATE CASCADE`,
        `ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_tableId_fkey" FOREIGN KEY ("tableId") REFERENCES "ReservationTable"("id") ON DELETE SET NULL ON UPDATE CASCADE`,
        `ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE`,
      ],
    },
  ];

  for (const t of tablesToCreate) {
    const ex = await prisma.$queryRawUnsafe(
      `SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name=$1`,
      t.name,
    );
    if (ex.length === 0) {
      await prisma.$executeRawUnsafe(t.sql);
      for (const idx of t.indexes) await prisma.$executeRawUnsafe(idx);
      for (const fk of t.fks) await prisma.$executeRawUnsafe(fk);
      console.log(`✓ Tabla ${t.name} creada (+ indexes + FKs)`);
    } else {
      console.log(`✓ Tabla ${t.name} ya existe`);
    }
  }

  // 4) Marcar migration
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
