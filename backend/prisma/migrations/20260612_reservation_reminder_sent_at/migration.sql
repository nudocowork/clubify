-- Add reminderSentAt for 24h-before reminder cron
ALTER TABLE "Reservation" ADD COLUMN "reminderSentAt" TIMESTAMP(3);
CREATE INDEX "Reservation_reminderSentAt_status_idx" ON "Reservation"("reminderSentAt", "status");
