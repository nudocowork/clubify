-- ============================================================
-- Vendor hierarchy + commission attribution (FASE FOUNDATION)
-- ============================================================
-- Agrega sub-jerarquía VENDOR debajo de los AMBASSADOR + atribución
-- granular de comisiones para el 3-way split (influencer / embajador /
-- vendedor) en el webhook Hotmart. Backwards-compatible: todas las
-- columnas nuevas son nullable o tienen default.
--
-- 1. ReferralRole: agregar VENDOR.
-- 2. ReferralCode: allowVendors, maxCommissionPercent, parentEmbajadorCodeId.
-- 3. Commission: vendorCodeId, hotmartTransactionId, paymentStatus, amountPaid.
-- 4. Enum CommissionPaymentStatus.
-- 5. FK + índices.

-- 1) Enum VENDOR en ReferralRole + AFFILIATE_VENDOR en Role (User).
ALTER TYPE "ReferralRole" ADD VALUE IF NOT EXISTS 'VENDOR';
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'AFFILIATE_VENDOR';

-- 2) Columnas en ReferralCode.
ALTER TABLE "ReferralCode"
  ADD COLUMN IF NOT EXISTS "allowVendors" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "maxCommissionPercent" DECIMAL(5, 2),
  ADD COLUMN IF NOT EXISTS "parentEmbajadorCodeId" TEXT;

-- 3) Enum granular de pago.
DO $$ BEGIN
  CREATE TYPE "CommissionPaymentStatus" AS ENUM ('PENDING', 'PARTIAL', 'PAID');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- 4) Columnas en Commission.
ALTER TABLE "Commission"
  ADD COLUMN IF NOT EXISTS "vendorCodeId" TEXT,
  ADD COLUMN IF NOT EXISTS "recipientCodeId" TEXT,
  ADD COLUMN IF NOT EXISTS "hotmartTransactionId" TEXT,
  ADD COLUMN IF NOT EXISTS "paymentStatus" "CommissionPaymentStatus" NOT NULL DEFAULT 'PENDING',
  ADD COLUMN IF NOT EXISTS "amountPaid" DECIMAL(10, 2) NOT NULL DEFAULT 0;

-- 5) FK constraints (idempotente con DO block para no fallar si ya existen).
DO $$ BEGIN
  ALTER TABLE "ReferralCode"
    ADD CONSTRAINT "ReferralCode_parentEmbajadorCodeId_fkey"
    FOREIGN KEY ("parentEmbajadorCodeId") REFERENCES "ReferralCode"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "Commission"
    ADD CONSTRAINT "Commission_vendorCodeId_fkey"
    FOREIGN KEY ("vendorCodeId") REFERENCES "ReferralCode"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "Commission"
    ADD CONSTRAINT "Commission_recipientCodeId_fkey"
    FOREIGN KEY ("recipientCodeId") REFERENCES "ReferralCode"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- 6) Índices.
CREATE INDEX IF NOT EXISTS "ReferralCode_parentEmbajadorCodeId_idx"
  ON "ReferralCode" ("parentEmbajadorCodeId");

CREATE INDEX IF NOT EXISTS "Commission_vendorCodeId_idx"
  ON "Commission" ("vendorCodeId");

CREATE INDEX IF NOT EXISTS "Commission_recipientCodeId_idx"
  ON "Commission" ("recipientCodeId");

CREATE INDEX IF NOT EXISTS "Commission_hotmartTransactionId_idx"
  ON "Commission" ("hotmartTransactionId");
