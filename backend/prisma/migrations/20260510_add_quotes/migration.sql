-- Cotizaciones generadas por SUPER_ADMIN (asesores comerciales) para
-- prospects que aún no son tenants. priceSnapshot/currencySnapshot
-- congelan el precio al momento de crear para que futuros cambios en
-- Settings (pricing.*) no rompan PDFs generados antes.

CREATE TYPE "QuotePlan" AS ENUM ('ELITE', 'PRO');

CREATE TABLE "Quote" (
  "id"               TEXT NOT NULL,
  "customerName"     TEXT NOT NULL,
  "businessName"     TEXT NOT NULL,
  "phone"            TEXT,
  "email"            TEXT,
  "plan"             "QuotePlan" NOT NULL,
  "templateSlug"     TEXT,
  "advisorId"        TEXT,
  "advisorName"      TEXT NOT NULL,
  "priceSnapshot"    DECIMAL(10,2) NOT NULL,
  "currencySnapshot" TEXT NOT NULL DEFAULT 'USD',
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Quote_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Quote"
  ADD CONSTRAINT "Quote_advisorId_fkey"
  FOREIGN KEY ("advisorId") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "Quote_advisorId_idx"     ON "Quote"("advisorId");
CREATE INDEX "Quote_plan_idx"          ON "Quote"("plan");
CREATE INDEX "Quote_templateSlug_idx"  ON "Quote"("templateSlug");
CREATE INDEX "Quote_createdAt_idx"     ON "Quote"("createdAt");
