-- Bloque 2 (2026-06-12): toggles per-tenant para mostrar/ocultar los
-- links de Tutoriales (sidebar TENANT_OWNER) y Academia Clubify
-- (sidebar afiliados). Default TRUE para preservar comportamiento esperado.

ALTER TABLE "Tenant"
  ADD COLUMN "tutorialsEnabled" BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN "academyEnabled" BOOLEAN NOT NULL DEFAULT TRUE;
