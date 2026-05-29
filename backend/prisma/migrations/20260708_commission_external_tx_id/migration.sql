-- Dedup key para evitar doble-pay de comisiones cuando convertToPaying
-- manual genera Commission y después llega webhook Hotmart con misma
-- transaction. El backfill manual deja externalTxId=null; el webhook
-- Hotmart pasa el subscriber_code/transactionId del payload.

ALTER TABLE "Commission" ADD COLUMN "externalTxId" TEXT;

CREATE INDEX "Commission_externalTxId_idx"
  ON "Commission"("externalTxId");
