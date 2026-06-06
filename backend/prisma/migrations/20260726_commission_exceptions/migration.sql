-- ============================================================
-- Commission exceptions por cliente (item 6 sprint)
-- ============================================================
-- SUPER_ADMIN puede crear excepciones de % comisión por tenant que
-- sobreescriben la cadena de afiliados (influencer/embajador/vendedor)
-- solo para ese tenant. Aplica a comisiones futuras + PENDING; las ya
-- PAID no se tocan automáticamente.
--
-- Tablas nuevas, idempotente con IF NOT EXISTS para tolerar reaplicación
-- manual en prod (ver feedback_safe_deploys: deploys cuidadosos).

-- 1) CommissionException — 1 row por (tenant, recipientCode).
CREATE TABLE IF NOT EXISTS "CommissionException" (
  "id"              TEXT NOT NULL,
  "tenantId"        TEXT NOT NULL,
  "recipientCodeId" TEXT NOT NULL,
  "customPercent"   DECIMAL(5, 2) NOT NULL,
  "reason"          TEXT,
  "isActive"        BOOLEAN NOT NULL DEFAULT true,
  "createdById"     TEXT,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CommissionException_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "CommissionException_tenantId_recipientCodeId_key"
  ON "CommissionException"("tenantId", "recipientCodeId");
CREATE INDEX IF NOT EXISTS "CommissionException_tenantId_idx"
  ON "CommissionException"("tenantId");
CREATE INDEX IF NOT EXISTS "CommissionException_recipientCodeId_idx"
  ON "CommissionException"("recipientCodeId");

DO $$ BEGIN
  ALTER TABLE "CommissionException"
    ADD CONSTRAINT "CommissionException_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "CommissionException"
    ADD CONSTRAINT "CommissionException_recipientCodeId_fkey"
    FOREIGN KEY ("recipientCodeId") REFERENCES "ReferralCode"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "CommissionException"
    ADD CONSTRAINT "CommissionException_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2) CommissionExceptionHistory — snapshot por cambio.
CREATE TABLE IF NOT EXISTS "CommissionExceptionHistory" (
  "id"              TEXT NOT NULL,
  "exceptionId"     TEXT NOT NULL,
  "previousPercent" DECIMAL(5, 2),
  "newPercent"      DECIMAL(5, 2) NOT NULL,
  "previousActive"  BOOLEAN,
  "newActive"       BOOLEAN NOT NULL,
  "reason"          TEXT,
  "changedById"     TEXT,
  "changedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CommissionExceptionHistory_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "CommissionExceptionHistory_exceptionId_changedAt_idx"
  ON "CommissionExceptionHistory"("exceptionId", "changedAt");

DO $$ BEGIN
  ALTER TABLE "CommissionExceptionHistory"
    ADD CONSTRAINT "CommissionExceptionHistory_exceptionId_fkey"
    FOREIGN KEY ("exceptionId") REFERENCES "CommissionException"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "CommissionExceptionHistory"
    ADD CONSTRAINT "CommissionExceptionHistory_changedById_fkey"
    FOREIGN KEY ("changedById") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
