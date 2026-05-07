-- Popup de bienvenida ("agendar sesión personalizada") para tenants nuevos.
ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "welcomePopupSeenAt" TIMESTAMP(3);

-- Backfill: tenants que ya existían no deberían ver el popup, así que
-- los marcamos como "ya vistos" usando createdAt como timestamp.
UPDATE "Tenant"
   SET "welcomePopupSeenAt" = "createdAt"
 WHERE "welcomePopupSeenAt" IS NULL;
