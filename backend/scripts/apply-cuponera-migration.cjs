// Migraciones Cuponera / Living Card (Fase 1):
//   20260709020000_add_mercadopago_gateway  → enum PaymentGateway += MERCADOPAGO
//   20260709020100_add_cuponera_living_card → tablas BenefitCampaign, MembershipPlan,
//     LivingMembership, BenefitCategory, MembershipOrder, MercadopagoWebhookEvent
//     + Tenant.isCampaignHost + enums + FKs.
//
// Idempotente (IF NOT EXISTS / DO ... EXCEPTION duplicate_object). Correr ANTES
// de deployar el backend nuevo (el startCommand no corre migrate deploy fiable).
//   node scripts/apply-cuponera-migration.cjs
const { PrismaClient } = require('@prisma/client');
const crypto = require('crypto');

const STMTS = [
  // 1) Valor de enum en su propia sentencia (autocommit) — debe quedar
  //    commiteado ANTES de crear MembershipOrder (que lo usa como DEFAULT).
  `ALTER TYPE "PaymentGateway" ADD VALUE IF NOT EXISTS 'MERCADOPAGO'`,

  // 2) Enums nuevos (idempotentes).
  `DO $$ BEGIN CREATE TYPE "BenefitCampaignStatus" AS ENUM ('DRAFT','ACTIVE','PAUSED'); EXCEPTION WHEN duplicate_object THEN null; END $$`,
  `DO $$ BEGIN CREATE TYPE "MembershipInterval" AS ENUM ('MONTHLY','ANNUAL'); EXCEPTION WHEN duplicate_object THEN null; END $$`,
  `DO $$ BEGIN CREATE TYPE "MembershipStatus" AS ENUM ('PENDING','ACTIVE','EXPIRED','CANCELLED'); EXCEPTION WHEN duplicate_object THEN null; END $$`,
  `DO $$ BEGIN CREATE TYPE "MembershipSource" AS ENUM ('MANUAL','MERCADOPAGO'); EXCEPTION WHEN duplicate_object THEN null; END $$`,
  `DO $$ BEGIN CREATE TYPE "MembershipOrderStatus" AS ENUM ('PENDING','PAID','FAILED'); EXCEPTION WHEN duplicate_object THEN null; END $$`,

  // 3) Columna nueva en Tenant.
  `ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "isCampaignHost" BOOLEAN NOT NULL DEFAULT false`,

  // 4) Tablas.
  `CREATE TABLE IF NOT EXISTS "BenefitCampaign" (
      "id" TEXT NOT NULL,
      "whiteLabelId" TEXT,
      "tenantId" TEXT NOT NULL,
      "cardId" TEXT,
      "name" TEXT NOT NULL,
      "slug" TEXT NOT NULL,
      "status" "BenefitCampaignStatus" NOT NULL DEFAULT 'DRAFT',
      "welcomeText" TEXT NOT NULL DEFAULT '',
      "config" JSONB NOT NULL DEFAULT '{}',
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL,
      CONSTRAINT "BenefitCampaign_pkey" PRIMARY KEY ("id")
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "BenefitCampaign_tenantId_key" ON "BenefitCampaign"("tenantId")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "BenefitCampaign_slug_key" ON "BenefitCampaign"("slug")`,
  `CREATE INDEX IF NOT EXISTS "BenefitCampaign_whiteLabelId_idx" ON "BenefitCampaign"("whiteLabelId")`,

  `CREATE TABLE IF NOT EXISTS "MembershipPlan" (
      "id" TEXT NOT NULL,
      "campaignId" TEXT NOT NULL,
      "name" TEXT NOT NULL,
      "level" INTEGER NOT NULL DEFAULT 0,
      "priceCents" INTEGER NOT NULL DEFAULT 0,
      "currency" TEXT NOT NULL DEFAULT 'COP',
      "interval" "MembershipInterval" NOT NULL DEFAULT 'MONTHLY',
      "benefitsAllowance" INTEGER,
      "description" TEXT NOT NULL DEFAULT '',
      "isActive" BOOLEAN NOT NULL DEFAULT true,
      "sortOrder" INTEGER NOT NULL DEFAULT 0,
      "mpPreapprovalPlanId" TEXT,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL,
      CONSTRAINT "MembershipPlan_pkey" PRIMARY KEY ("id")
  )`,
  `CREATE INDEX IF NOT EXISTS "MembershipPlan_campaignId_idx" ON "MembershipPlan"("campaignId")`,

  `CREATE TABLE IF NOT EXISTS "LivingMembership" (
      "id" TEXT NOT NULL,
      "campaignId" TEXT NOT NULL,
      "customerId" TEXT NOT NULL,
      "planId" TEXT,
      "status" "MembershipStatus" NOT NULL DEFAULT 'PENDING',
      "source" "MembershipSource" NOT NULL DEFAULT 'MANUAL',
      "memberLevel" INTEGER NOT NULL DEFAULT 0,
      "activatedAt" TIMESTAMP(3),
      "expiresAt" TIMESTAMP(3),
      "passId" TEXT,
      "mpPreapprovalId" TEXT,
      "mpPayerId" TEXT,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL,
      CONSTRAINT "LivingMembership_pkey" PRIMARY KEY ("id")
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "LivingMembership_campaignId_customerId_key" ON "LivingMembership"("campaignId","customerId")`,
  `CREATE INDEX IF NOT EXISTS "LivingMembership_customerId_idx" ON "LivingMembership"("customerId")`,
  `CREATE INDEX IF NOT EXISTS "LivingMembership_status_idx" ON "LivingMembership"("status")`,

  `CREATE TABLE IF NOT EXISTS "BenefitCategory" (
      "id" TEXT NOT NULL,
      "campaignId" TEXT NOT NULL,
      "name" TEXT NOT NULL,
      "slug" TEXT NOT NULL,
      "icon" TEXT NOT NULL DEFAULT '',
      "sortOrder" INTEGER NOT NULL DEFAULT 0,
      "isActive" BOOLEAN NOT NULL DEFAULT true,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "BenefitCategory_pkey" PRIMARY KEY ("id")
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "BenefitCategory_campaignId_slug_key" ON "BenefitCategory"("campaignId","slug")`,
  `CREATE INDEX IF NOT EXISTS "BenefitCategory_campaignId_idx" ON "BenefitCategory"("campaignId")`,

  `CREATE TABLE IF NOT EXISTS "MembershipOrder" (
      "id" TEXT NOT NULL,
      "campaignId" TEXT NOT NULL,
      "planId" TEXT,
      "customerId" TEXT,
      "email" TEXT NOT NULL DEFAULT '',
      "amountCents" INTEGER NOT NULL DEFAULT 0,
      "currency" TEXT NOT NULL DEFAULT 'COP',
      "status" "MembershipOrderStatus" NOT NULL DEFAULT 'PENDING',
      "provider" "PaymentGateway" NOT NULL DEFAULT 'MERCADOPAGO',
      "providerRef" TEXT,
      "rawPayload" JSONB NOT NULL DEFAULT '{}',
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL,
      CONSTRAINT "MembershipOrder_pkey" PRIMARY KEY ("id")
  )`,
  `CREATE INDEX IF NOT EXISTS "MembershipOrder_campaignId_idx" ON "MembershipOrder"("campaignId")`,
  `CREATE INDEX IF NOT EXISTS "MembershipOrder_providerRef_idx" ON "MembershipOrder"("providerRef")`,

  `CREATE TABLE IF NOT EXISTS "MercadopagoWebhookEvent" (
      "id" TEXT NOT NULL,
      "eventId" TEXT NOT NULL,
      "eventType" TEXT NOT NULL,
      "campaignId" TEXT,
      "payload" JSONB NOT NULL,
      "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "MercadopagoWebhookEvent_pkey" PRIMARY KEY ("id")
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "MercadopagoWebhookEvent_eventId_key" ON "MercadopagoWebhookEvent"("eventId")`,
  `CREATE INDEX IF NOT EXISTS "MercadopagoWebhookEvent_campaignId_eventType_processedAt_idx" ON "MercadopagoWebhookEvent"("campaignId","eventType","processedAt")`,

  // 5) Foreign keys (idempotentes).
  `DO $$ BEGIN ALTER TABLE "BenefitCampaign" ADD CONSTRAINT "BenefitCampaign_whiteLabelId_fkey" FOREIGN KEY ("whiteLabelId") REFERENCES "WhiteLabel"("id") ON DELETE SET NULL ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN null; END $$`,
  `DO $$ BEGIN ALTER TABLE "BenefitCampaign" ADD CONSTRAINT "BenefitCampaign_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN null; END $$`,
  `DO $$ BEGIN ALTER TABLE "MembershipPlan" ADD CONSTRAINT "MembershipPlan_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "BenefitCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN null; END $$`,
  `DO $$ BEGIN ALTER TABLE "LivingMembership" ADD CONSTRAINT "LivingMembership_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "BenefitCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN null; END $$`,
  `DO $$ BEGIN ALTER TABLE "LivingMembership" ADD CONSTRAINT "LivingMembership_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN null; END $$`,
  `DO $$ BEGIN ALTER TABLE "LivingMembership" ADD CONSTRAINT "LivingMembership_planId_fkey" FOREIGN KEY ("planId") REFERENCES "MembershipPlan"("id") ON DELETE SET NULL ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN null; END $$`,
  `DO $$ BEGIN ALTER TABLE "BenefitCategory" ADD CONSTRAINT "BenefitCategory_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "BenefitCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN null; END $$`,
  `DO $$ BEGIN ALTER TABLE "MembershipOrder" ADD CONSTRAINT "MembershipOrder_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "BenefitCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN null; END $$`,
  `DO $$ BEGIN ALTER TABLE "MembershipOrder" ADD CONSTRAINT "MembershipOrder_planId_fkey" FOREIGN KEY ("planId") REFERENCES "MembershipPlan"("id") ON DELETE SET NULL ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN null; END $$`,
];

(async () => {
  const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
  if (!url) { console.error('No DATABASE_URL'); process.exit(1); }
  const prisma = new PrismaClient({ datasources: { db: { url } } });

  for (const sql of STMTS) {
    await prisma.$executeRawUnsafe(sql);
  }
  console.log('✅ DDL Cuponera/Living Card aplicado (idempotente).');

  // Registrar ambas migraciones en _prisma_migrations si faltan.
  for (const name of ['20260709020000_add_mercadopago_gateway', '20260709020100_add_cuponera_living_card']) {
    const exists = await prisma.$queryRawUnsafe(
      `SELECT 1 FROM "_prisma_migrations" WHERE migration_name = $1 LIMIT 1`, name,
    );
    if (!exists.length) {
      await prisma.$executeRawUnsafe(
        `INSERT INTO "_prisma_migrations" (id, checksum, migration_name, started_at, finished_at, applied_steps_count)
         VALUES ($1, $2, $3, now(), now(), 1)`,
        crypto.randomUUID(), 'manual-apply', name,
      );
      console.log(`✅ Registrada migración ${name}.`);
    } else {
      console.log(`• ${name} ya estaba registrada.`);
    }
  }

  console.log('\nListo. El tenant de sistema y la campaña Living Card se crean on-demand desde el panel.');
  await prisma.$disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
