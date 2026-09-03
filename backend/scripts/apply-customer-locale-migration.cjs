// Migración 20260830_customer_locale (PDF 854 wallet i18n):
//   - Customer.locale String @default("es") — idioma elegido al enrolarse,
//     usado para localizar el pase de wallet (Apple/Google). Los clientes
//     existentes quedan en 'es' (sin cambio de comportamiento).
// Idempotente. Correr ANTES de deployar el backend nuevo.
//   DRY:  railway run --service Postgres-Nq8w node .../apply-customer-locale-migration.cjs
const { PrismaClient } = require('@prisma/client');
const crypto = require('crypto');
(async () => {
  const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
  if (!url) { console.error('No DATABASE_URL'); process.exit(1); }
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  const name = '20260830_customer_locale';

  await prisma.$executeRawUnsafe(
    `ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS "locale" TEXT NOT NULL DEFAULT 'es'`,
  );
  console.log('✅ DDL aplicado (columna Customer.locale, idempotente).');

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

  const total = await prisma.customer.count();
  console.log(`\nClientes: ${total} (todos en locale='es' por default). Listo, ahora deployá el backend.`);
  await prisma.$disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
