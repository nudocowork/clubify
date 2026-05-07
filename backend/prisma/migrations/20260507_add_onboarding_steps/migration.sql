-- Pasos 2 y 3 del onboarding (chained después del welcome popup)
ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "businessAddressOnboardedAt" TIMESTAMP(3);
ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "businessCategoryOnboardedAt" TIMESTAMP(3);

-- Backfill: tenants existentes ya están "onboardeados" — no quiero
-- mostrarles los popups en su próximo login. Marcamos como vistos.
UPDATE "Tenant" SET "businessAddressOnboardedAt" = "createdAt" WHERE "businessAddressOnboardedAt" IS NULL;
UPDATE "Tenant" SET "businessCategoryOnboardedAt" = "createdAt" WHERE "businessCategoryOnboardedAt" IS NULL;
