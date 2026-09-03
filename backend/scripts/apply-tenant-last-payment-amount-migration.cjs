// Migración 20260731000000_add_tenant_last_payment_amount: agrega
// Tenant.lastPaymentAmountUsd (monto crudo pagado, SOLO auditoría — nunca
// comisiones). Aditiva e idempotente. Correr ANTES de deployar el backend:
//   railway run --service Postgres-Nq8w node scripts/apply-tenant-last-payment-amount-migration.cjs
const { PrismaClient } = require('@prisma/client');
const crypto = require('crypto');
(async () => {
  const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
  if (!url) { console.error('No DATABASE_URL'); process.exit(1); }
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  const name = '20260731000000_add_tenant_last_payment_amount';

  await prisma.$executeRawUnsafe(
    `ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "lastPaymentAmountUsd" DECIMAL(10,2)`,
  );
  console.log('✅ Columna lastPaymentAmountUsd (idempotente).');

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
