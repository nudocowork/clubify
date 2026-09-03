-- PayoutBatch (lote de corte) + Commission.payoutBatchId + Commission.paidAtLegacy.
-- Brief comisiones (continuación) PASO 3. Todo aditivo/nullable → sin impacto
-- en filas existentes. Idempotente (IF NOT EXISTS / DO $$).

-- Enum PayoutBatchKind (idempotente).
DO $$ BEGIN
  CREATE TYPE "PayoutBatchKind" AS ENUM ('CORTE', 'ADJUSTMENT');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- Tabla PayoutBatch.
CREATE TABLE IF NOT EXISTS "PayoutBatch" (
  "id"          TEXT NOT NULL,
  "code"        TEXT NOT NULL,
  "cutoffDate"  TIMESTAMP(3) NOT NULL,
  "paymentDate" TIMESTAMP(3) NOT NULL,
  "kind"        "PayoutBatchKind" NOT NULL DEFAULT 'CORTE',
  "totalUsd"    DECIMAL(10,2) NOT NULL DEFAULT 0,
  "currency"    TEXT NOT NULL DEFAULT 'USD',
  "notes"       TEXT,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PayoutBatch_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "PayoutBatch_code_key" ON "PayoutBatch"("code");
CREATE INDEX IF NOT EXISTS "PayoutBatch_paymentDate_idx" ON "PayoutBatch"("paymentDate");

-- Columnas nuevas en Commission.
ALTER TABLE "Commission" ADD COLUMN IF NOT EXISTS "payoutBatchId" TEXT;
ALTER TABLE "Commission" ADD COLUMN IF NOT EXISTS "paidAtLegacy" TIMESTAMP(3);
CREATE INDEX IF NOT EXISTS "Commission_payoutBatchId_idx" ON "Commission"("payoutBatchId");

-- FK Commission.payoutBatchId -> PayoutBatch.id (SetNull). Idempotente.
DO $$ BEGIN
  ALTER TABLE "Commission" ADD CONSTRAINT "Commission_payoutBatchId_fkey"
    FOREIGN KEY ("payoutBatchId") REFERENCES "PayoutBatch"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
