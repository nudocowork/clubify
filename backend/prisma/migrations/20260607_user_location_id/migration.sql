-- ============================================================
-- Fase F — User.locationId (staff asociado a sede)
-- ============================================================
-- Permite asociar miembros del equipo (TENANT_OWNER / TENANT_STAFF) a
-- una sede específica para rankings de sellos por miembro + ubicación.
-- Null = sin sede asignada o aplica a todas las sedes.
--
-- Idempotente con IF NOT EXISTS.

ALTER TABLE "User"
  ADD COLUMN IF NOT EXISTS "locationId" TEXT;

DO $$ BEGIN
  ALTER TABLE "User"
    ADD CONSTRAINT "User_locationId_fkey"
    FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "User_locationId_idx" ON "User"("locationId");
