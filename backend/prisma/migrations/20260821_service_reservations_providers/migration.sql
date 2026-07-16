-- Fase 5: profesionales + gestión de cita por token. Aditivo.
CREATE TABLE IF NOT EXISTS "ServiceProvider" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ServiceProvider_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "ServiceProvider_tenantId_isActive_idx" ON "ServiceProvider"("tenantId","isActive");

ALTER TABLE "ServiceAvailability" ADD COLUMN IF NOT EXISTS "providerId" TEXT;
CREATE INDEX IF NOT EXISTS "ServiceAvailability_tenantId_providerId_weekday_idx" ON "ServiceAvailability"("tenantId","providerId","weekday");

ALTER TABLE "Appointment" ADD COLUMN IF NOT EXISTS "providerId" TEXT;
ALTER TABLE "Appointment" ADD COLUMN IF NOT EXISTS "manageToken" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "Appointment_manageToken_key" ON "Appointment"("manageToken");
CREATE INDEX IF NOT EXISTS "Appointment_providerId_startAt_idx" ON "Appointment"("providerId","startAt");
