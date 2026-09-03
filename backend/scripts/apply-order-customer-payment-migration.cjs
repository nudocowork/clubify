// Migración 20260725000000_add_order_customer_payment_method (PDF 2026-07-25):
//   - Order.customerPaymentMethod  (EFECTIVO|TARJETA|TRANSFERENCIA|OTRO)
//   - Order.customerPaymentOther   (texto libre cuando es OTRO)
// Método de pago DECLARADO por el cliente (o editado por el negocio),
// informativo, independiente del gateway online. Idempotente (IF NOT EXISTS).
// Correr ANTES de deployar el backend nuevo:
//   railway run --service Postgres-Nq8w node scripts/apply-order-customer-payment-migration.cjs
const { PrismaClient } = require('@prisma/client');
const crypto = require('crypto');
(async () => {
  const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
  if (!url) { console.error('No DATABASE_URL'); process.exit(1); }
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  const name = '20260725000000_add_order_customer_payment_method';

  const stmts = [
    `ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "customerPaymentMethod" TEXT`,
    `ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "customerPaymentOther" TEXT`,
  ];
  for (const s of stmts) await prisma.$executeRawUnsafe(s);
  console.log(`✅ DDL aplicado (${stmts.length} columnas, idempotente).`);

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
  } else {
    console.log('• Ya estaba registrada.');
  }
  await prisma.$disconnect();
  console.log('Listo para deployar el backend.');
})().catch((e) => { console.error(e); process.exit(1); });
