-- Eventos y asistentes
CREATE TYPE "EventStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'CANCELLED', 'COMPLETED');
CREATE TYPE "AttendeeStatus" AS ENUM ('CONFIRMED', 'CHECKED_IN', 'CANCELLED', 'NO_SHOW');

CREATE TABLE "ReservationEvent" (
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
);

CREATE INDEX "ReservationEvent_tenantId_date_status_idx" ON "ReservationEvent"("tenantId", "date", "status");
CREATE INDEX "ReservationEvent_locationId_idx" ON "ReservationEvent"("locationId");

ALTER TABLE "ReservationEvent" ADD CONSTRAINT "ReservationEvent_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ReservationEvent" ADD CONSTRAINT "ReservationEvent_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "EventAttendee" (
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
);

CREATE INDEX "EventAttendee_eventId_idx" ON "EventAttendee"("eventId");
CREATE INDEX "EventAttendee_tenantId_idx" ON "EventAttendee"("tenantId");
CREATE INDEX "EventAttendee_customerId_idx" ON "EventAttendee"("customerId");

ALTER TABLE "EventAttendee" ADD CONSTRAINT "EventAttendee_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EventAttendee" ADD CONSTRAINT "EventAttendee_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "ReservationEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EventAttendee" ADD CONSTRAINT "EventAttendee_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
