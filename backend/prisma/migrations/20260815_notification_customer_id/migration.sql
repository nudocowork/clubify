-- Notification.customerId: destinatario individual de una notificación (push de
-- cumpleaños/inactividad). null = broadcast. El campo lastMessage del pase Apple
-- solo muestra notificaciones con customerId null o == dueño del pase → un
-- cliente nunca ve el saludo personalizado de otro.
ALTER TABLE "Notification" ADD COLUMN IF NOT EXISTS "customerId" TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'Notification_customerId_fkey'
  ) THEN
    ALTER TABLE "Notification"
      ADD CONSTRAINT "Notification_customerId_fkey"
      FOREIGN KEY ("customerId") REFERENCES "Customer"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "Notification_customerId_sentAt_idx" ON "Notification"("customerId", "sentAt");

-- Backfill: las notificaciones de automation ya guardan el customerId en stats.
-- Sin esto quedarían como customerId NULL = broadcast → seguirían mostrándose a
-- todos. Las pasamos a su destinatario real.
UPDATE "Notification"
  SET "customerId" = "stats"->>'customerId'
  WHERE "customerId" IS NULL
    AND "stats" ? 'customerId'
    AND ("stats"->>'customerId') IS NOT NULL
    AND ("stats"->>'customerId') <> ''
    AND EXISTS (SELECT 1 FROM "Customer" c WHERE c.id = "stats"->>'customerId');
