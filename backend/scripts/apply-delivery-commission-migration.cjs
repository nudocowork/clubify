// Migración 20260824_delivery_commission (Fase 4 — comisiones de domicilio):
//   - DeliveryCompany.brandSharePct (Int, default 0)
//   - enum DeliveryCommissionStatus (PENDING/PAID)
//   - DeliveryCommission (1 por delivery; monto fijo por empresa, split marca/master)
// Idempotente. Correr ANTES de deployar el backend nuevo.
// Usage:
//   railway run --service Postgres-Nq8w node /ABS/PATH/backend/scripts/apply-delivery-commission-migration.cjs
const { PrismaClient } = require('@prisma/client');
const crypto = require('crypto');

(async () => {
  const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
  if (!url) {
    console.error('No DATABASE_URL');
    process.exit(1);
  }
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  const name = '20260824_delivery_commission';

  const statements = [
    `ALTER TABLE "DeliveryCompany" ADD COLUMN IF NOT EXISTS "brandSharePct" INTEGER NOT NULL DEFAULT 0`,
    `DO $$ BEGIN
       CREATE TYPE "DeliveryCommissionStatus" AS ENUM ('PENDING','PAID');
     EXCEPTION WHEN duplicate_object THEN null; END $$`,
    `CREATE TABLE IF NOT EXISTS "DeliveryCommission" (
       "id" TEXT NOT NULL,
       "deliveryId" TEXT NOT NULL,
       "orderId" TEXT NOT NULL,
       "deliveryCompanyId" TEXT,
       "whiteLabelId" TEXT,
       "amount" DECIMAL(10,2) NOT NULL,
       "brandAmount" DECIMAL(10,2) NOT NULL,
       "masterAmount" DECIMAL(10,2) NOT NULL,
       "currency" TEXT NOT NULL DEFAULT 'USD',
       "status" "DeliveryCommissionStatus" NOT NULL DEFAULT 'PENDING',
       "paidAt" TIMESTAMP(3),
       "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
       CONSTRAINT "DeliveryCommission_pkey" PRIMARY KEY ("id"),
       CONSTRAINT "DeliveryCommission_deliveryId_fkey" FOREIGN KEY ("deliveryId")
         REFERENCES "Delivery"("id") ON DELETE CASCADE ON UPDATE CASCADE,
       CONSTRAINT "DeliveryCommission_deliveryCompanyId_fkey" FOREIGN KEY ("deliveryCompanyId")
         REFERENCES "DeliveryCompany"("id") ON DELETE SET NULL ON UPDATE CASCADE
     )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS "DeliveryCommission_deliveryId_key" ON "DeliveryCommission"("deliveryId")`,
    `CREATE INDEX IF NOT EXISTS "DeliveryCommission_deliveryCompanyId_status_idx" ON "DeliveryCommission"("deliveryCompanyId","status")`,
    `CREATE INDEX IF NOT EXISTS "DeliveryCommission_whiteLabelId_status_idx" ON "DeliveryCommission"("whiteLabelId","status")`,
    `CREATE INDEX IF NOT EXISTS "DeliveryCommission_status_createdAt_idx" ON "DeliveryCommission"("status","createdAt")`,
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
