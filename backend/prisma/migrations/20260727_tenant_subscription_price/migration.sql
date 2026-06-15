-- ============================================================
-- Tenant.subscriptionPriceUsd
-- ============================================================
-- Precio REAL que el cliente pagó en Hotmart por su ciclo
-- (payload.data.purchase.price.value). Es la FUENTE DE VERDAD para la
-- base de comisiones: la directa del afiliado, el 5% indirecto del
-- influencer y el 10% del socio se calculan sobre este monto.
--
-- Nullable + sin default: tenants viejos no lo tienen y el cálculo cae
-- al precio canónico del bundle (getCommissionBase → getBundlePrice).
-- Crítico para el legacy del link de $50: esos negocios pagaron 50, no
-- 68; al setearlo (auto desde webhook o manual desde /admin/tenants)
-- las comisiones dejan de sobre-estimarse. Backwards-compatible.

ALTER TABLE "Tenant"
  ADD COLUMN IF NOT EXISTS "subscriptionPriceUsd" DECIMAL(10, 2);
