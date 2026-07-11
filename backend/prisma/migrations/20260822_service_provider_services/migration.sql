-- Fase 5 extra: qué servicios hace cada profesional. Vacío = todos. Aditivo.
ALTER TABLE "ServiceProvider"
  ADD COLUMN IF NOT EXISTS "serviceIds" TEXT[] NOT NULL DEFAULT '{}';
