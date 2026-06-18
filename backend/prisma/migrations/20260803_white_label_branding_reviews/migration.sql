-- Branding extendido de la marca (logo + colores + redes/contacto) y nuevo
-- módulo REVIEWS. Idempotente.

ALTER TABLE "WhiteLabel" ADD COLUMN IF NOT EXISTS "logoUrl" TEXT;
ALTER TABLE "WhiteLabel" ADD COLUMN IF NOT EXISTS "secondaryColor" TEXT;
ALTER TABLE "WhiteLabel" ADD COLUMN IF NOT EXISTS "backgroundColor" TEXT;
ALTER TABLE "WhiteLabel" ADD COLUMN IF NOT EXISTS "supportColor" TEXT;
ALTER TABLE "WhiteLabel" ADD COLUMN IF NOT EXISTS "instagram" TEXT;
ALTER TABLE "WhiteLabel" ADD COLUMN IF NOT EXISTS "contactEmail" TEXT;

ALTER TYPE "ModuleKey" ADD VALUE IF NOT EXISTS 'REVIEWS';
