-- Trial público (/prueba o /trial). Campos opcionales que capturamos en
-- el form del prospect + tracking de recordatorios SMS internos al equipo.
ALTER TABLE "Tenant" ADD COLUMN "trialSource" TEXT;
ALTER TABLE "Tenant" ADD COLUMN "trialCompany" TEXT;
ALTER TABLE "Tenant" ADD COLUMN "trialCity" TEXT;
ALTER TABLE "Tenant" ADD COLUMN "trialReminderLastSent" TEXT;
