-- Google Review Filter: tenant guarda su URL de Google Reviews + tabla
-- de feedback negativo capturado privado.

ALTER TABLE "Tenant" ADD COLUMN "googleReviewUrl" TEXT;

CREATE TABLE "ReviewFeedback" (
  "id"                 TEXT NOT NULL,
  "tenantId"           TEXT NOT NULL,
  "rating"             INTEGER NOT NULL,
  "comment"            TEXT,
  "customerName"       TEXT,
  "customerPhone"      TEXT,
  "redirectedToGoogle" BOOLEAN NOT NULL DEFAULT false,
  "isRead"             BOOLEAN NOT NULL DEFAULT false,
  "createdAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ReviewFeedback_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "ReviewFeedback"
  ADD CONSTRAINT "ReviewFeedback_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "ReviewFeedback_tenantId_createdAt_idx"
  ON "ReviewFeedback"("tenantId", "createdAt");
CREATE INDEX "ReviewFeedback_tenantId_rating_idx"
  ON "ReviewFeedback"("tenantId", "rating");
