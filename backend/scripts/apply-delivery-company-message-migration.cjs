// Migración 20260832_delivery_company_message (PDF 1254 domicilios):
//   - Tabla DeliveryCompanyMessage: chat directo negocio↔empresa por NEGOCIO
//     (no por pedido). Idempotente. Correr ANTES de deployar.
const { PrismaClient } = require('@prisma/client');
const crypto = require('crypto');
(async () => {
  const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
  if (!url) { console.error('No DATABASE_URL'); process.exit(1); }
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  const name = '20260832_delivery_company_message';

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "DeliveryCompanyMessage" (
      "id" TEXT PRIMARY KEY,
      "deliveryCompanyId" TEXT NOT NULL REFERENCES "DeliveryCompany"("id") ON DELETE CASCADE,
      "tenantId" TEXT NOT NULL REFERENCES "Tenant"("id") ON DELETE CASCADE,
      "senderRole" "DeliveryChatRole" NOT NULL,
      "senderName" TEXT,
      "body" TEXT NOT NULL,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);
  await prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS "DeliveryCompanyMessage_company_tenant_idx" ON "DeliveryCompanyMessage"("deliveryCompanyId","tenantId","createdAt")`,
  );
  await prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS "DeliveryCompanyMessage_tenant_idx" ON "DeliveryCompanyMessage"("tenantId","createdAt")`,
  );
  console.log('✅ Tabla + índices (idempotente).');

  const exists = await prisma.$queryRawUnsafe(
    `SELECT 1 FROM "_prisma_migrations" WHERE migration_name = $1 LIMIT 1`, name,
  );
  if (!exists.length) {
    await prisma.$executeRawUnsafe(
      `INSERT INTO "_prisma_migrations" (id, checksum, migration_name, started_at, finished_at, applied_steps_count)
       VALUES ($1, $2, $3, now(), now(), 1)`,
      crypto.randomUUID(), 'manual-apply', name,
    );
    console.log('✅ Registrada en _prisma_migrations.');
  } else console.log('• Ya estaba registrada.');
  await prisma.$disconnect();
  console.log('Listo para deployar.');
})().catch((e) => { console.error(e); process.exit(1); });
