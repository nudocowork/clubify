-- ============================================================
-- ReferralCode.defaultVendorCommissionPercent
-- ============================================================
-- El embajador puede preconfigurar el % de comisión por venta que
-- usará automáticamente cuando un vendedor se autoregistra desde
-- /seller/register/<ambassadorCode>. Si null, el backend cae a 10%.
-- Solo aplica a codes con role=AMBASSADOR + allowVendors=true.
-- Backwards-compatible: nullable, sin default.

ALTER TABLE "ReferralCode"
  ADD COLUMN IF NOT EXISTS "defaultVendorCommissionPercent" DECIMAL(5, 2);
