-- QR Posters / Marketing: cada tenant tiene hasta 1 cartel por tipo (MENU,
-- COUNTER, DISCOUNT, REVIEWS). config guarda el JSON serializado del editor
-- visual de Konva. lastExportUrl referencia el último PNG/PDF subido a R2.

CREATE TYPE "QrPosterType" AS ENUM ('MENU', 'COUNTER', 'DISCOUNT', 'REVIEWS');

CREATE TABLE "QrPoster" (
  "id"            TEXT NOT NULL,
  "tenantId"      TEXT NOT NULL,
  "type"          "QrPosterType" NOT NULL,
  "name"          TEXT NOT NULL DEFAULT '',
  "config"        JSONB NOT NULL DEFAULT '{}',
  "lastExportUrl" TEXT,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL,
  CONSTRAINT "QrPoster_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "QrPoster"
  ADD CONSTRAINT "QrPoster_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE UNIQUE INDEX "QrPoster_tenantId_type_key"
  ON "QrPoster"("tenantId", "type");
CREATE INDEX "QrPoster_tenantId_idx"
  ON "QrPoster"("tenantId");
