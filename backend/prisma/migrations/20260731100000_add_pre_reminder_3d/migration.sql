-- Recordatorio "3 días antes" del próximo cobro (PDF 1256 §4). Idempotencia por
-- ciclo. Aditiva e idempotente.
ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "preReminder3dSentFor" TIMESTAMP(3);
