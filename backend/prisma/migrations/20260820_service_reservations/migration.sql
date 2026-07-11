-- P7: módulo de Reservas de Servicios (citas). Aditivo.
ALTER TYPE "ModuleKey" ADD VALUE IF NOT EXISTS 'SERVICE_RESERVATIONS';

ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "serviceReservationsEnabled" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS "Service" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "durationMin" INTEGER NOT NULL DEFAULT 30,
  "priceCents" INTEGER,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Service_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "Service_tenantId_isActive_idx" ON "Service"("tenantId","isActive");

CREATE TABLE IF NOT EXISTS "ServiceAvailability" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "weekday" INTEGER NOT NULL,
  "startMin" INTEGER NOT NULL,
  "endMin" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ServiceAvailability_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "ServiceAvailability_tenantId_weekday_idx" ON "ServiceAvailability"("tenantId","weekday");

CREATE TABLE IF NOT EXISTS "ServiceException" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "date" DATE NOT NULL,
  "closed" BOOLEAN NOT NULL DEFAULT true,
  "startMin" INTEGER,
  "endMin" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ServiceException_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "ServiceException_tenantId_date_key" ON "ServiceException"("tenantId","date");

CREATE TABLE IF NOT EXISTS "Appointment" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "serviceId" TEXT NOT NULL,
  "customerId" TEXT,
  "customerName" TEXT NOT NULL,
  "customerPhone" TEXT NOT NULL,
  "startAt" TIMESTAMP(3) NOT NULL,
  "endAt" TIMESTAMP(3) NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'confirmed',
  "notes" TEXT,
  "reminderSentAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Appointment_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "Appointment_tenantId_startAt_idx" ON "Appointment"("tenantId","startAt");
CREATE INDEX IF NOT EXISTS "Appointment_serviceId_startAt_idx" ON "Appointment"("serviceId","startAt");

ALTER TABLE "Appointment"
  ADD CONSTRAINT "Appointment_serviceId_fkey"
  FOREIGN KEY ("serviceId") REFERENCES "Service"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
