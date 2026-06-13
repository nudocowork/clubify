-- Reservations module 2026-06-12

-- Tenant flag
ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "reservationsEnabled" BOOLEAN NOT NULL DEFAULT false;

-- Enums
DO $$ BEGIN
  CREATE TYPE "ReservationStatus" AS ENUM ('PENDING', 'CONFIRMED', 'SEATED', 'COMPLETED', 'CANCELLED', 'NO_SHOW');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "ReservationChannel" AS ENUM ('WEB', 'WHATSAPP', 'PHONE', 'QR', 'IN_PERSON');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Zone
CREATE TABLE IF NOT EXISTS "ReservationZone" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "type" TEXT NOT NULL DEFAULT 'INDOOR',
  "position" INTEGER NOT NULL DEFAULT 0,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ReservationZone_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "ReservationZone_tenantId_slug_key" ON "ReservationZone"("tenantId", "slug");
CREATE INDEX IF NOT EXISTS "ReservationZone_tenantId_isActive_idx" ON "ReservationZone"("tenantId", "isActive");

-- Table
CREATE TABLE IF NOT EXISTS "ReservationTable" (
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
);
CREATE INDEX IF NOT EXISTS "ReservationTable_tenantId_isActive_idx" ON "ReservationTable"("tenantId", "isActive");
CREATE INDEX IF NOT EXISTS "ReservationTable_zoneId_idx" ON "ReservationTable"("zoneId");

-- Reservation
CREATE TABLE IF NOT EXISTS "Reservation" (
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
);
CREATE INDEX IF NOT EXISTS "Reservation_tenantId_date_status_idx" ON "Reservation"("tenantId", "date", "status");
CREATE INDEX IF NOT EXISTS "Reservation_tableId_idx" ON "Reservation"("tableId");
CREATE INDEX IF NOT EXISTS "Reservation_customerId_idx" ON "Reservation"("customerId");

-- FKs
ALTER TABLE "ReservationZone" ADD CONSTRAINT "ReservationZone_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ReservationTable" ADD CONSTRAINT "ReservationTable_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ReservationTable" ADD CONSTRAINT "ReservationTable_zoneId_fkey"
  FOREIGN KEY ("zoneId") REFERENCES "ReservationZone"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_zoneId_fkey"
  FOREIGN KEY ("zoneId") REFERENCES "ReservationZone"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_tableId_fkey"
  FOREIGN KEY ("tableId") REFERENCES "ReservationTable"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
