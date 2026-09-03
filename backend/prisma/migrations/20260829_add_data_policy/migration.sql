-- PDF Software(8): política de tratamiento de datos. Idempotente.
-- Documento del negocio (URL/PDF) + toggle por tarjeta + evidencia de aceptación.
ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "dataPolicyUrl" TEXT;
ALTER TABLE "Card" ADD COLUMN IF NOT EXISTS "dataPolicyEnabled" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Pass" ADD COLUMN IF NOT EXISTS "dataPolicyAcceptedAt" TIMESTAMP(3);
ALTER TABLE "Pass" ADD COLUMN IF NOT EXISTS "dataPolicyUrl" TEXT;
