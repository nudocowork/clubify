-- Card.minAmountPerStamp: monto mínimo de compra para otorgar sello
-- (STAMPS/VISITS/HYBRID). Null = sin restricción.
ALTER TABLE "Card"
  ADD COLUMN IF NOT EXISTS "minAmountPerStamp" DECIMAL(12, 2);
