-- Reservas por sede: Location.reservationsEnabled. Default true = compat (todas
-- las sedes existentes siguen aceptando reservas). Aditiva e idempotente.
ALTER TABLE "Location" ADD COLUMN IF NOT EXISTS "reservationsEnabled" BOOLEAN NOT NULL DEFAULT true;
