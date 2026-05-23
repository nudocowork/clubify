-- Alertas SMS automáticas a empresas de domicilio cuando un pedido
-- delivery cambia de estado. Aditivo. Default enabled=false (opt-in).

ALTER TABLE "Tenant" ADD COLUMN "deliveryAlertsEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Tenant" ADD COLUMN "deliveryAlertsPhones" JSONB;
ALTER TABLE "Tenant" ADD COLUMN "deliveryAlertsEvents" JSONB;
ALTER TABLE "Tenant" ADD COLUMN "deliveryAlertsAccountId" TEXT;
ALTER TABLE "Tenant"
  ADD CONSTRAINT "Tenant_deliveryAlertsAccountId_fkey"
  FOREIGN KEY ("deliveryAlertsAccountId")
  REFERENCES "GrowBusinessAccount"("id")
  ON DELETE SET NULL
  ON UPDATE CASCADE;
