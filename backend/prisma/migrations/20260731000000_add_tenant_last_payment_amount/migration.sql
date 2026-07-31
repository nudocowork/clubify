-- Base de comisiones = override manual (subscriptionPriceUsd) o canónico del
-- plan. El monto crudo (FX) que reporta Hotmart/Stripe se guarda acá SOLO para
-- auditoría/reportes/conciliación — nunca para calcular comisiones.
-- Aditiva e idempotente. 2026-07-31.
ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "lastPaymentAmountUsd" DECIMAL(10,2);
