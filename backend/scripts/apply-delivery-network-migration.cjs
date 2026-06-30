// Migración 20260821_delivery_network (Fase 1 — Red de Domicilios):
//   - enum DeliveryStatus
//   - DeliveryCompany (empresa de domicilios, la crea el Master Admin)
//   - DeliveryCompanyBrand / DeliveryCompanyTenant (marcas/negocios habilitados)
//   - Delivery (seguimiento logístico 1:1 con Order; NO toca Order.status)
// Idempotente (IF NOT EXISTS / DO-block para el enum) + registra en
// _prisma_migrations. Correr ANTES de deployar el backend nuevo.
// Usage:
//   railway run --service Postgres-Nq8w node /ABS/PATH/backend/scripts/apply-delivery-network-migration.cjs
const { PrismaClient } = require('@prisma/client');
const crypto = require('crypto');

(async () => {
  const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
  if (!url) {
    console.error('No DATABASE_URL');
    process.exit(1);
  }
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  const name = '20260821_delivery_network';

  const statements = [
    `DO $$ BEGIN
       CREATE TYPE "DeliveryStatus" AS ENUM ('WAITING_COURIER','COURIER_ASSIGNED','PICKED_UP','ON_THE_WAY','DELIVERED','CANCELLED');
     EXCEPTION WHEN duplicate_object THEN null; END $$`,

    `CREATE TABLE IF NOT EXISTS "DeliveryCompany" (
       "id" TEXT NOT NULL,
       "whiteLabelId" TEXT,
       "name" TEXT NOT NULL,
       "logoUrl" TEXT,
       "whatsapp" TEXT,
       "city" TEXT,
       "responsible" TEXT,
       "email" TEXT,
       "commissionPerDelivery" DECIMAL(10,2),
       "isActive" BOOLEAN NOT NULL DEFAULT true,
       "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
       "updatedAt" TIMESTAMP(3) NOT NULL,
       CONSTRAINT "DeliveryCompany_pkey" PRIMARY KEY ("id"),
       CONSTRAINT "DeliveryCompany_whiteLabelId_fkey" FOREIGN KEY ("whiteLabelId")
         REFERENCES "WhiteLabel"("id") ON DELETE SET NULL ON UPDATE CASCADE
     )`,
    `CREATE INDEX IF NOT EXISTS "DeliveryCompany_whiteLabelId_idx" ON "DeliveryCompany"("whiteLabelId")`,
    `CREATE INDEX IF NOT EXISTS "DeliveryCompany_isActive_idx" ON "DeliveryCompany"("isActive")`,

    `CREATE TABLE IF NOT EXISTS "DeliveryCompanyBrand" (
       "id" TEXT NOT NULL,
       "deliveryCompanyId" TEXT NOT NULL,
       "whiteLabelId" TEXT NOT NULL,
       CONSTRAINT "DeliveryCompanyBrand_pkey" PRIMARY KEY ("id"),
       CONSTRAINT "DeliveryCompanyBrand_deliveryCompanyId_fkey" FOREIGN KEY ("deliveryCompanyId")
         REFERENCES "DeliveryCompany"("id") ON DELETE CASCADE ON UPDATE CASCADE,
       CONSTRAINT "DeliveryCompanyBrand_whiteLabelId_fkey" FOREIGN KEY ("whiteLabelId")
         REFERENCES "WhiteLabel"("id") ON DELETE CASCADE ON UPDATE CASCADE
     )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS "DeliveryCompanyBrand_deliveryCompanyId_whiteLabelId_key" ON "DeliveryCompanyBrand"("deliveryCompanyId","whiteLabelId")`,
    `CREATE INDEX IF NOT EXISTS "DeliveryCompanyBrand_whiteLabelId_idx" ON "DeliveryCompanyBrand"("whiteLabelId")`,

    `CREATE TABLE IF NOT EXISTS "DeliveryCompanyTenant" (
       "id" TEXT NOT NULL,
       "deliveryCompanyId" TEXT NOT NULL,
       "tenantId" TEXT NOT NULL,
       CONSTRAINT "DeliveryCompanyTenant_pkey" PRIMARY KEY ("id"),
       CONSTRAINT "DeliveryCompanyTenant_deliveryCompanyId_fkey" FOREIGN KEY ("deliveryCompanyId")
         REFERENCES "DeliveryCompany"("id") ON DELETE CASCADE ON UPDATE CASCADE,
       CONSTRAINT "DeliveryCompanyTenant_tenantId_fkey" FOREIGN KEY ("tenantId")
         REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE
     )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS "DeliveryCompanyTenant_deliveryCompanyId_tenantId_key" ON "DeliveryCompanyTenant"("deliveryCompanyId","tenantId")`,
    `CREATE INDEX IF NOT EXISTS "DeliveryCompanyTenant_tenantId_idx" ON "DeliveryCompanyTenant"("tenantId")`,

    `CREATE TABLE IF NOT EXISTS "Delivery" (
       "id" TEXT NOT NULL,
       "orderId" TEXT NOT NULL,
       "tenantId" TEXT NOT NULL,
       "deliveryCompanyId" TEXT,
       "status" "DeliveryStatus" NOT NULL DEFAULT 'WAITING_COURIER',
       "courierName" TEXT,
       "courierPhone" TEXT,
       "courierPlate" TEXT,
       "etaMinutes" INTEGER,
       "address" TEXT,
       "deliveryValue" DECIMAL(10,2),
       "assignedAt" TIMESTAMP(3),
       "pickedUpAt" TIMESTAMP(3),
       "onTheWayAt" TIMESTAMP(3),
       "deliveredAt" TIMESTAMP(3),
       "cancelledAt" TIMESTAMP(3),
       "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
       "updatedAt" TIMESTAMP(3) NOT NULL,
       CONSTRAINT "Delivery_pkey" PRIMARY KEY ("id"),
       CONSTRAINT "Delivery_orderId_fkey" FOREIGN KEY ("orderId")
         REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE,
       CONSTRAINT "Delivery_tenantId_fkey" FOREIGN KEY ("tenantId")
         REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE,
       CONSTRAINT "Delivery_deliveryCompanyId_fkey" FOREIGN KEY ("deliveryCompanyId")
         REFERENCES "DeliveryCompany"("id") ON DELETE SET NULL ON UPDATE CASCADE
     )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS "Delivery_orderId_key" ON "Delivery"("orderId")`,
    `CREATE INDEX IF NOT EXISTS "Delivery_tenantId_status_idx" ON "Delivery"("tenantId","status")`,
    `CREATE INDEX IF NOT EXISTS "Delivery_deliveryCompanyId_status_idx" ON "Delivery"("deliveryCompanyId","status")`,
  ];

  for (const st of statements) {
    await prisma.$executeRawUnsafe(st);
  }
  console.log(`✅ DDL aplicado (${statements.length} sentencias, idempotente).`);

  const exists = await prisma.$queryRawUnsafe(
    `SELECT 1 FROM "_prisma_migrations" WHERE migration_name = $1 LIMIT 1`,
    name,
  );
  if (!exists.length) {
    await prisma.$executeRawUnsafe(
      `INSERT INTO "_prisma_migrations" (id, checksum, migration_name, started_at, finished_at, applied_steps_count)
       VALUES ($1, $2, $3, now(), now(), 1)`,
      crypto.randomUUID(),
      'manual-apply',
      name,
    );
    console.log('✅ Registrada en _prisma_migrations.');
  } else {
    console.log('• Ya estaba registrada en _prisma_migrations.');
  }

  await prisma.$disconnect();
  console.log('\nListo. Ahora sí deployá el backend.');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
