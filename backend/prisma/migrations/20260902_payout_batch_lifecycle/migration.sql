-- Ciclo de vida del corte (cortes automáticos por calendario, 2026-08-15).
-- El cron ABRE el corte el 15 y el último día de cada mes (hora Bogotá); una
-- PERSONA lo cierra cuando confirma la transferencia real.
-- Todo aditivo/nullable + idempotente. Los 3 cortes históricos existentes se
-- migran a CLOSED con su paymentDate real — NO se recalculan sus montos.

-- Enum PayoutBatchStatus (idempotente).
DO $$ BEGIN
  CREATE TYPE "PayoutBatchStatus" AS ENUM ('OPEN', 'CLOSED');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- Columnas nuevas.
ALTER TABLE "PayoutBatch" ADD COLUMN IF NOT EXISTS "status" "PayoutBatchStatus" NOT NULL DEFAULT 'OPEN';
ALTER TABLE "PayoutBatch" ADD COLUMN IF NOT EXISTS "periodStart" TIMESTAMP(3);
ALTER TABLE "PayoutBatch" ADD COLUMN IF NOT EXISTS "periodEnd" TIMESTAMP(3);
ALTER TABLE "PayoutBatch" ADD COLUMN IF NOT EXISTS "reference" TEXT;
ALTER TABLE "PayoutBatch" ADD COLUMN IF NOT EXISTS "closedAt" TIMESTAMP(3);
ALTER TABLE "PayoutBatch" ADD COLUMN IF NOT EXISTS "closedByUserId" TEXT;
ALTER TABLE "PayoutBatch" ADD COLUMN IF NOT EXISTS "generatedAuto" BOOLEAN NOT NULL DEFAULT false;

-- paymentDate pasa a NULLABLE: un corte recién abierto todavía no tiene
-- transferencia real. Se captura al cerrarlo.
ALTER TABLE "PayoutBatch" ALTER COLUMN "paymentDate" DROP NOT NULL;

CREATE INDEX IF NOT EXISTS "PayoutBatch_status_idx" ON "PayoutBatch"("status");

-- FK closedByUserId -> User.id (SetNull). Idempotente.
DO $$ BEGIN
  ALTER TABLE "PayoutBatch" ADD CONSTRAINT "PayoutBatch_closedByUserId_fkey"
    FOREIGN KEY ("closedByUserId") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- MIGRACIÓN DE LOS CORTES EXISTENTES: todo lote que ya existía nació de un pago
-- ya transferido (CORTE-2026-06-30, CORTE-2026-07-15, CORTE-2026-07-31), así que
-- queda CERRADO con su fecha real. Solo toca filas creadas ANTES de esta
-- migración (createdAt < now()) y que sigan en el default OPEN sin closedAt →
-- correrla dos veces no reabre ni pisa nada.
UPDATE "PayoutBatch"
   SET "status" = 'CLOSED',
       "closedAt" = COALESCE("paymentDate", "createdAt"),
       "generatedAuto" = false
 WHERE "status" = 'OPEN'
   AND "closedAt" IS NULL
   AND "paymentDate" IS NOT NULL;
