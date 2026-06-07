-- ============================================================
-- Fase D — Pago de comisiones (PaymentProfile + Payouts)
-- ============================================================
-- Sistema completo: el afiliado llena su perfil (Binance o cuenta
-- bancaria), el SUPER_ADMIN aprueba, y cuando acumula >= 50 USD entra
-- a "Listo por pagar". Al pagar, el admin crea un CommissionPayout
-- con comprobante (R2). Una commission entra a un solo payout (unique).
--
-- Idempotente con IF NOT EXISTS / DO blocks para reaplicación segura.

-- --------------------------------------------------------------
-- Enums nuevos.
-- --------------------------------------------------------------

DO $$ BEGIN
  ALTER TYPE "CommissionStatus" ADD VALUE IF NOT EXISTS 'RETAINED';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "PaymentMethodKind" AS ENUM ('BINANCE', 'BANK');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "PaymentProfileStatus" AS ENUM (
    'NONE', 'PENDING_REVIEW', 'APPROVED', 'REJECTED'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "CommissionPayoutStatus" AS ENUM (
    'PROCESSING', 'PAID', 'REVERSED'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- --------------------------------------------------------------
-- PaymentProfile (1 por User afiliado).
-- --------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "PaymentProfile" (
  "id"               TEXT PRIMARY KEY,
  "userId"           TEXT UNIQUE NOT NULL,
  "status"           "PaymentProfileStatus" NOT NULL DEFAULT 'NONE',
  "firstName"        TEXT,
  "lastName"         TEXT,
  "phoneCountry"     TEXT,
  "phone"            TEXT,
  "method"           "PaymentMethodKind",
  "binanceEmail"     TEXT,
  "binancePhone"     TEXT,
  "binanceNote"      TEXT,
  "bankCountry"      TEXT,
  "bankName"         TEXT,
  "bankAccountType"  TEXT,
  "bankAccountNo"    TEXT,
  "bankHolderName"   TEXT,
  "bankHolderDoc"    TEXT,
  "bankNote"         TEXT,
  "rejectionReason"  TEXT,
  "reviewedByUserId" TEXT,
  "reviewedAt"       TIMESTAMP(3),
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PaymentProfile_user_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE,
  CONSTRAINT "PaymentProfile_reviewer_fkey" FOREIGN KEY ("reviewedByUserId") REFERENCES "User"("id") ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS "PaymentProfile_status_idx" ON "PaymentProfile"("status");

-- --------------------------------------------------------------
-- CommissionPayout (batch de pago a un afiliado).
-- --------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "CommissionPayout" (
  "id"              TEXT PRIMARY KEY,
  "recipientUserId" TEXT NOT NULL,
  "amount"          DECIMAL(10, 2) NOT NULL,
  "currency"        TEXT NOT NULL DEFAULT 'USD',
  "status"          "CommissionPayoutStatus" NOT NULL DEFAULT 'PROCESSING',
  "methodSnapshot"  JSONB NOT NULL,
  "proofUrl"        TEXT,
  "proofMimeType"   TEXT,
  "paidByUserId"    TEXT,
  "paidAt"          TIMESTAMP(3),
  "notes"           TEXT,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CommissionPayout_recipient_fkey" FOREIGN KEY ("recipientUserId") REFERENCES "User"("id") ON DELETE CASCADE,
  CONSTRAINT "CommissionPayout_paidBy_fkey" FOREIGN KEY ("paidByUserId") REFERENCES "User"("id") ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS "CommissionPayout_recipientUserId_idx" ON "CommissionPayout"("recipientUserId");
CREATE INDEX IF NOT EXISTS "CommissionPayout_status_idx" ON "CommissionPayout"("status");

-- --------------------------------------------------------------
-- CommissionPayoutItem (puente: 1 commission entra a 1 payout).
-- --------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "CommissionPayoutItem" (
  "id"           TEXT PRIMARY KEY,
  "payoutId"     TEXT NOT NULL,
  "commissionId" TEXT UNIQUE NOT NULL,
  "amount"       DECIMAL(10, 2) NOT NULL,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CommissionPayoutItem_payout_fkey" FOREIGN KEY ("payoutId") REFERENCES "CommissionPayout"("id") ON DELETE CASCADE,
  CONSTRAINT "CommissionPayoutItem_commission_fkey" FOREIGN KEY ("commissionId") REFERENCES "Commission"("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "CommissionPayoutItem_payoutId_idx" ON "CommissionPayoutItem"("payoutId");
