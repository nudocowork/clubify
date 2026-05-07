-- Notificaciones programadas (calendario en /app/notifications)
ALTER TABLE "Notification" ADD COLUMN IF NOT EXISTS "scheduledAt" TIMESTAMP(3);
CREATE INDEX IF NOT EXISTS "Notification_scheduledAt_idx" ON "Notification"("scheduledAt");

-- Agrega 'SCHEDULED' al enum NotificationTrigger si no está
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumlabel = 'SCHEDULED'
      AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'NotificationTrigger')
  ) THEN
    ALTER TYPE "NotificationTrigger" ADD VALUE 'SCHEDULED' AFTER 'MANUAL';
  END IF;
END $$;
