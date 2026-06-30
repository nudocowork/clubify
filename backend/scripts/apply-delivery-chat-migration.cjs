// Migración 20260823_delivery_chat (Fase 3B — chat del domicilio):
//   - enum DeliveryChatRole (CUSTOMER/BUSINESS/COMPANY)
//   - DeliveryMessage (hilo por pedido, 3 partes)
// Idempotente. Correr ANTES de deployar el backend nuevo.
// Usage:
//   railway run --service Postgres-Nq8w node /ABS/PATH/backend/scripts/apply-delivery-chat-migration.cjs
const { PrismaClient } = require('@prisma/client');
const crypto = require('crypto');

(async () => {
  const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
  if (!url) {
    console.error('No DATABASE_URL');
    process.exit(1);
  }
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  const name = '20260823_delivery_chat';

  const statements = [
    `DO $$ BEGIN
       CREATE TYPE "DeliveryChatRole" AS ENUM ('CUSTOMER','BUSINESS','COMPANY');
     EXCEPTION WHEN duplicate_object THEN null; END $$`,
    `CREATE TABLE IF NOT EXISTS "DeliveryMessage" (
       "id" TEXT NOT NULL,
       "orderId" TEXT NOT NULL,
       "senderRole" "DeliveryChatRole" NOT NULL,
       "senderName" TEXT,
       "body" TEXT NOT NULL,
       "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
       CONSTRAINT "DeliveryMessage_pkey" PRIMARY KEY ("id"),
       CONSTRAINT "DeliveryMessage_orderId_fkey" FOREIGN KEY ("orderId")
         REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE
     )`,
    `CREATE INDEX IF NOT EXISTS "DeliveryMessage_orderId_createdAt_idx" ON "DeliveryMessage"("orderId","createdAt")`,
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
