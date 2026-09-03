// Aplica 20260824_add_payment_link_product_key (WhiteLabelPaymentLink.productKey TEXT
// nullable) y la registra en _prisma_migrations. Aditivo + idempotente.
// Correr ANTES del deploy del backend que la usa.
// Usage: railway run --service Postgres-Nq8w node scripts/apply-payment-link-product-key.cjs
const { PrismaClient } = require('@prisma/client');
const crypto = require('crypto');

const DDL = [
  `ALTER TABLE "WhiteLabelPaymentLink" ADD COLUMN IF NOT EXISTS "productKey" TEXT`,
];

(async () => {
  const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
  if (!url) { console.error('No DATABASE_URL'); process.exit(1); }
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  const name = '20260824_add_payment_link_product_key';

  for (const sql of DDL) await prisma.$executeRawUnsafe(sql);

  const col = await prisma.$queryRawUnsafe(
    `SELECT 1 FROM information_schema.columns
     WHERE table_name='WhiteLabelPaymentLink' AND column_name='productKey'`);
  console.log('• WhiteLabelPaymentLink.productKey:', col.length ? '✓ columna presente' : 'FALTA ✗');

  const exists = await prisma.$queryRawUnsafe(
    `SELECT 1 FROM "_prisma_migrations" WHERE migration_name=$1 LIMIT 1`, name);
  if (!exists.length) {
    await prisma.$executeRawUnsafe(
      `INSERT INTO "_prisma_migrations" (id, checksum, migration_name, started_at, finished_at, applied_steps_count)
       VALUES ($1,$2,$3,now(),now(),1)`,
      crypto.randomUUID(), 'manual-apply', name);
    console.log('✅ Registrada en _prisma_migrations.');
  } else console.log('• Ya registrada.');

  await prisma.$disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
