-- M7.3 (2026-06-04): targets de QR de reseñas multi-sede.
-- Cada sede del negocio puede tener su propio QR de reseñas con su
-- propia URL de Google Reviews + métricas independientes. Antes solo
-- existía 1 link (Tenant.googleReviewUrl) y 1 threshold global; ahora
-- el QR puede llevar un targetId que apunta a la sede correcta.

CREATE TABLE "ReviewQrTarget" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "locationId" TEXT,
    "name" TEXT NOT NULL,
    "googleReviewUrl" TEXT NOT NULL,
    -- Threshold inclusive: rating >= threshold → Google. Default 4.
    "threshold" INTEGER NOT NULL DEFAULT 4,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReviewQrTarget_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ReviewQrTarget_tenantId_idx" ON "ReviewQrTarget"("tenantId");
CREATE INDEX "ReviewQrTarget_locationId_idx" ON "ReviewQrTarget"("locationId");

ALTER TABLE "ReviewQrTarget" ADD CONSTRAINT "ReviewQrTarget_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ReviewQrTarget" ADD CONSTRAINT "ReviewQrTarget_locationId_fkey"
  FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Métricas por target: agregamos targetId nullable a ReviewFeedback.
-- Las visitas se trackean en QrPosterVisit (ya existente). Para las
-- estrellas 1-3 (feedback privado) sumamos targetId acá; las 4-5 que
-- redirigen a Google las contamos por QrPoster.
ALTER TABLE "ReviewFeedback" ADD COLUMN "reviewTargetId" TEXT;
CREATE INDEX "ReviewFeedback_reviewTargetId_idx" ON "ReviewFeedback"("reviewTargetId");
ALTER TABLE "ReviewFeedback" ADD CONSTRAINT "ReviewFeedback_reviewTargetId_fkey"
  FOREIGN KEY ("reviewTargetId") REFERENCES "ReviewQrTarget"("id") ON DELETE SET NULL ON UPDATE CASCADE;
