-- Comisión FIJA de referidos (EXCLUSIVO marcas en modo FIXED_ONCE, hoy Sellea).
-- Aditivo. El seed de Settings por-marca va en
-- scripts/apply-referral-fixed-commission.cjs (no en SQL, para resolver el slug).
ALTER TABLE "ReferralCode" ADD COLUMN IF NOT EXISTS "fixedCommissionUsd" DECIMAL(10,2);
