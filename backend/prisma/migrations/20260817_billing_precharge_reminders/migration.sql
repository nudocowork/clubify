-- Serie pre-cobro (PDF734): idempotencia por ciclo de los recordatorios
-- amables "7 días antes" y "mismo día del cobro". Nullable, sin backfill:
-- los tenants existentes empiezan sin marca y recibirán el 1er recordatorio
-- del ciclo en curso (comportamiento correcto).
ALTER TABLE "Tenant"
  ADD COLUMN IF NOT EXISTS "preReminder7dSentFor" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "preReminderTodaySentFor" TIMESTAMP(3);
