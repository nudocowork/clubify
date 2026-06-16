-- #24 (2026-06-16): nombre de marca por tarjeta para el pase wallet.
-- Aditivo y nullable → seguro, sin downtime. Si null, el pase cae al
-- Tenant.brandName (comportamiento actual).
ALTER TABLE "Card" ADD COLUMN IF NOT EXISTS "walletBrandName" TEXT;
