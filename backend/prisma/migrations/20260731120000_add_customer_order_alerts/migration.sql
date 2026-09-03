-- PDF 1256 F3: notificaciones de pedido al CLIENTE final por SMS. Opt-in.
-- Aditiva e idempotente.
ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "customerOrderAlertsEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "customerOrderAlertsEvents" JSONB;
