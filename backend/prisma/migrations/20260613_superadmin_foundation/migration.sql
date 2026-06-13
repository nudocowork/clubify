-- Nivel 1 — Plataforma / Master Admin (Fidelia)
-- Enums
ALTER TYPE "Role" ADD VALUE 'PLATFORM_OWNER' BEFORE 'SUPER_ADMIN';
CREATE TYPE "WhiteLabelStatus" AS ENUM ('ACTIVE', 'SUSPENDED');
CREATE TYPE "ModuleKey" AS ENUM ('REFERRALS', 'ORDERS', 'GROW_BUSINESS_SMS');
CREATE TYPE "CreditTransactionType" AS ENUM ('PURCHASE', 'CONSUME', 'COMMIT', 'REFUND', 'ADJUSTMENT');

CREATE TABLE "WhiteLabel" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "domain" TEXT,
  "appDomain" TEXT,
  "primaryColor" TEXT NOT NULL DEFAULT '#16a34a',
  "initial" TEXT,
  "adminEmail" TEXT,
  "status" "WhiteLabelStatus" NOT NULL DEFAULT 'ACTIVE',
  "creditsAvailable" INTEGER NOT NULL DEFAULT 0,
  "creditsCommitted" INTEGER NOT NULL DEFAULT 0,
  "creditsUsed" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "WhiteLabel_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "WhiteLabel_slug_key" ON "WhiteLabel"("slug");
CREATE INDEX "WhiteLabel_status_idx" ON "WhiteLabel"("status");

CREATE TABLE "WhiteLabelModule" (
  "id" TEXT NOT NULL,
  "whiteLabelId" TEXT NOT NULL,
  "module" "ModuleKey" NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "WhiteLabelModule_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "WhiteLabelModule_whiteLabelId_module_key" ON "WhiteLabelModule"("whiteLabelId", "module");
CREATE INDEX "WhiteLabelModule_module_idx" ON "WhiteLabelModule"("module");
ALTER TABLE "WhiteLabelModule" ADD CONSTRAINT "WhiteLabelModule_whiteLabelId_fkey" FOREIGN KEY ("whiteLabelId") REFERENCES "WhiteLabel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "CreditTransaction" (
  "id" TEXT NOT NULL,
  "whiteLabelId" TEXT NOT NULL,
  "type" "CreditTransactionType" NOT NULL,
  "amount" INTEGER NOT NULL,
  "note" TEXT,
  "tenantId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CreditTransaction_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "CreditTransaction_whiteLabelId_createdAt_idx" ON "CreditTransaction"("whiteLabelId", "createdAt");
ALTER TABLE "CreditTransaction" ADD CONSTRAINT "CreditTransaction_whiteLabelId_fkey" FOREIGN KEY ("whiteLabelId") REFERENCES "WhiteLabel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "HotmartCreditLink" (
  "id" TEXT NOT NULL,
  "credits" INTEGER NOT NULL,
  "label" TEXT NOT NULL,
  "url" TEXT NOT NULL,
  "price" DECIMAL(12,2),
  "currency" TEXT NOT NULL DEFAULT 'MXN',
  "position" INTEGER NOT NULL DEFAULT 0,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "HotmartCreditLink_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "HotmartCreditLink_isActive_position_idx" ON "HotmartCreditLink"("isActive", "position");

CREATE TABLE "PlatformIntegration" (
  "id" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "status" TEXT NOT NULL DEFAULT 'DISCONNECTED',
  "config" JSONB NOT NULL DEFAULT '{}',
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PlatformIntegration_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PlatformIntegration_key_key" ON "PlatformIntegration"("key");

-- Tenant.whiteLabelId
ALTER TABLE "Tenant" ADD COLUMN "whiteLabelId" TEXT;
CREATE INDEX "Tenant_whiteLabelId_idx" ON "Tenant"("whiteLabelId");
ALTER TABLE "Tenant" ADD CONSTRAINT "Tenant_whiteLabelId_fkey" FOREIGN KEY ("whiteLabelId") REFERENCES "WhiteLabel"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Seed: Clubify como primera Marca Blanca + asignar todos los tenants existentes
INSERT INTO "WhiteLabel" ("id", "name", "slug", "domain", "appDomain", "primaryColor", "initial", "adminEmail", "status", "creditsAvailable", "creditsCommitted", "creditsUsed", "createdAt", "updatedAt")
VALUES (gen_random_uuid()::text, 'Clubify', 'clubify', 'soyclubify.com', 'app.soyclubify.com', '#22c55e', 'C', 'jhonarias888@gmail.com', 'ACTIVE', 0, 0, 0, NOW(), NOW());

UPDATE "Tenant" SET "whiteLabelId" = (SELECT "id" FROM "WhiteLabel" WHERE "slug" = 'clubify')
WHERE "whiteLabelId" IS NULL;

-- Módulos por defecto para Clubify (todos ON)
INSERT INTO "WhiteLabelModule" ("id", "whiteLabelId", "module", "enabled", "updatedAt")
SELECT gen_random_uuid()::text, w."id", m."module"::"ModuleKey", true, NOW()
FROM "WhiteLabel" w
CROSS JOIN (VALUES ('REFERRALS'), ('ORDERS'), ('GROW_BUSINESS_SMS')) AS m("module")
WHERE w."slug" = 'clubify';
