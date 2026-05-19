-- Tenant demo lock: bloquea writes cuando isLocked=true para no-SUPER_ADMIN.
-- Útil para crear cuentas demo que los embajadores muestran sin que las toquen.

ALTER TABLE "Tenant"
  ADD COLUMN "isLocked" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "lockedAt" TIMESTAMP(3),
  ADD COLUMN "lockedReason" TEXT;
