-- Logo dedicado para banner de notificaciones push (icon.png del .pkpass).
-- Idempotente: ADD COLUMN IF NOT EXISTS para que Railway no falle al re-aplicar.
ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "pushLogoUrl" TEXT;
