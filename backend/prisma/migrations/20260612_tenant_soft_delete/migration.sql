-- Bloque 5 (2026-06-12): soft-delete de Tenant.
-- Cuando está seteado, el tenant queda inaccesible (filtrado en list/
-- login/me) pero las relaciones (Order/Commission/ReferralUse) se
-- preservan para auditoría contable. Default null = activo (compat).

ALTER TABLE "Tenant"
  ADD COLUMN "deletedAt" TIMESTAMP(3);

CREATE INDEX "Tenant_deletedAt_idx" ON "Tenant"("deletedAt");
