-- ============================================================
-- CommissionPayout.feeUsd + netUsd (costo de retiro)
-- ============================================================
-- Spec 2026-06-15: si el retiro es >= 50 USD es gratis; si es menor se
-- descuenta un costo de retiro de 3 USD. amount sigue siendo el BRUTO;
-- feeUsd guarda el costo aplicado y netUsd lo efectivamente transferido
-- (bruto − fee). Backwards-compatible: feeUsd default 0, netUsd nullable
-- (los payouts viejos no lo tienen → el front cae a amount).

ALTER TABLE "CommissionPayout"
  ADD COLUMN IF NOT EXISTS "feeUsd" DECIMAL(10, 2) NOT NULL DEFAULT 0;

ALTER TABLE "CommissionPayout"
  ADD COLUMN IF NOT EXISTS "netUsd" DECIMAL(10, 2);
