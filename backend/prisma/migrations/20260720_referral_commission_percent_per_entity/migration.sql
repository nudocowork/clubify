-- Comisión 100% editable por afiliado/embajador/influencer/socio.
-- La columna `commissionPercent` ya existe en producción (Decimal(5,2)
-- con default 20). Esta migración es idempotente: garantiza que el
-- esquema actual matchea Prisma schema en cualquier entorno donde
-- no haya sido creada todavía (dev limpio, e2e fresh DB, etc).
--
-- Si la columna ya existe: no-op.
-- Si no existe: la crea con Decimal(5,2) NOT NULL DEFAULT 20.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'ReferralCode'
      AND column_name = 'commissionPercent'
  ) THEN
    ALTER TABLE "ReferralCode"
      ADD COLUMN "commissionPercent" DECIMAL(5, 2) NOT NULL DEFAULT 20;
  END IF;
END$$;
