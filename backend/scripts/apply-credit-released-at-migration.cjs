// Migración 20260731110000_add_credit_released_at: Tenant.creditReleasedAt
// (idempotencia de la liberación de crédito a la marca al suspender, PDF 1256 §2).
// Aditiva e idempotente. Correr ANTES de deployar el backend:
//   railway run --service Postgres-Nq8w node scripts/apply-credit-released-at-migration.cjs
const { PrismaClient } = require('@prisma/client');
const crypto = require('crypto');
(async () => {
  const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
  if (!url) { console.error('No DATABASE_URL'); process.exit(1); }
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  const name = '20260731110000_add_credit_released_at';
  await prisma.$executeRawUnsafe(
    `ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "creditReleasedAt" TIMESTAMP(3)`,
  );
  console.log('✅ Columna creditReleasedAt (idempotente).');
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
  } else { console.log('• Ya estaba registrada.'); }
  await prisma.$disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
