-- Tenant.billing* — SMS de recordatorios de pago via subcuenta global
-- compartida de Grow Business (mismo patrón que reviewAlerts). Default
-- enabled=true para preservar comportamiento legacy (billing siempre
-- venía mandando antes del toggle).

ALTER TABLE "Tenant" ADD COLUMN "billingAlertsEnabled" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Tenant" ADD COLUMN "billingAlertsPhone" TEXT;
ALTER TABLE "Tenant" ADD COLUMN "billingAlertsAccountId" TEXT;
ALTER TABLE "Tenant"
  ADD CONSTRAINT "Tenant_billingAlertsAccountId_fkey"
  FOREIGN KEY ("billingAlertsAccountId")
  REFERENCES "GrowBusinessAccount"("id")
  ON DELETE SET NULL
  ON UPDATE CASCADE;

-- GrowBusinessAccount.purpose para agrupar subcuentas por uso desde el
-- UI del super admin. "GENERAL" default para no romper las existentes.
ALTER TABLE "GrowBusinessAccount" ADD COLUMN "purpose" TEXT NOT NULL DEFAULT 'GENERAL';
