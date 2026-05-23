-- Alertas SMS por reseñas negativas. Aditivo: enabled=false en tenants
-- existentes; threshold 3 = se dispara para 1, 2 y 3 estrellas cuando
-- se active. Phone y template null = fallback al backend.

ALTER TABLE "Tenant" ADD COLUMN "reviewAlertsEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Tenant" ADD COLUMN "reviewAlertsThreshold" INTEGER NOT NULL DEFAULT 3;
ALTER TABLE "Tenant" ADD COLUMN "reviewAlertsPhone" TEXT;
ALTER TABLE "Tenant" ADD COLUMN "reviewAlertsTemplate" TEXT;
