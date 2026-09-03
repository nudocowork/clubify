-- Onboarding Sync API — ju1053 Fase 3. Campos nuevos (subset útil).
-- Idempotente: IF NOT EXISTS para poder re-aplicar sin error.
ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "tiktokUrl" TEXT;
ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "websiteUrl" TEXT;
ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "city" TEXT;
ALTER TABLE "Card" ADD COLUMN IF NOT EXISTS "couponCode" TEXT;
ALTER TABLE "Card" ADD COLUMN IF NOT EXISTS "couponQuantity" INTEGER;
