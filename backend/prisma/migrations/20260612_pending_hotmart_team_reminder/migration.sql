-- Bloque "rescate de pagos huérfanos" — 2026-06-12.
-- Agrega `teamReminderSentAt` para que el cron pueda marcar idempotente
-- los avisos al founder cuando el comprador no completó /activar en 1h+.

ALTER TABLE "PendingHotmartPayment"
  ADD COLUMN "teamReminderSentAt" TIMESTAMP(3);

CREATE INDEX "PendingHotmartPayment_teamReminderSentAt_idx"
  ON "PendingHotmartPayment"("teamReminderSentAt");
