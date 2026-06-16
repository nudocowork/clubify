-- #37 (2026-06-16): país del afiliado (ISO-2) en ReferralCode.
-- Nullable, sin default: los codes legacy quedan en NULL.
ALTER TABLE "ReferralCode" ADD COLUMN IF NOT EXISTS "country" TEXT;
