-- Reservas online: días habilitados + observaciones/términos para el cliente.
-- Aditiva e idempotente. reservationDays vacío = todos los días (compat).
ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "reservationDays" INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[];
ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "reservationTerms" TEXT;
