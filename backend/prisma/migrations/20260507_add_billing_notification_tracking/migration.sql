-- Tracking de notificaciones de cobro automáticas (idempotencia del cron diario).
ALTER TABLE "Tenant" ADD COLUMN "paymentReminderSentFor" TIMESTAMP(3);
ALTER TABLE "Tenant" ADD COLUMN "paymentFailureNoticeSentAt" TIMESTAMP(3);
ALTER TABLE "Tenant" ADD COLUMN "pausePendingNoticeSentAt" TIMESTAMP(3);
