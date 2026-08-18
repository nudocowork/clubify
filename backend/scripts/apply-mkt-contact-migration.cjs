// Aplica 20260904_add_mkt_contact (tabla MktContact + índices + índices ÚNICOS
// PARCIALES por marca) y la registra en _prisma_migrations. Aditivo + idempotente
// (CREATE TABLE/INDEX IF NOT EXISTS). Correr ANTES del deploy del backend que la usa.
// Usage: railway run --service Postgres-Nq8w node scripts/apply-mkt-contact-migration.cjs
const { PrismaClient } = require('@prisma/client');
const crypto = require('crypto');

const DDL = [
  `CREATE TABLE IF NOT EXISTS "MktContact" (
    "id" TEXT NOT NULL,
    "whiteLabelId" TEXT NOT NULL,
    "name" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "phoneKey" TEXT,
    "phoneNorm" TEXT,
    "company" TEXT,
    "tags" TEXT[],
    "optOut" BOOLEAN NOT NULL DEFAULT false,
    "providerContactId" TEXT,
    "providerLocationId" TEXT,
    "providerSyncedAt" TIMESTAMP(3),
    "deleted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MktContact_pkey" PRIMARY KEY ("id")
  )`,
  `CREATE INDEX IF NOT EXISTS "MktContact_whiteLabelId_phoneKey_idx" ON "MktContact"("whiteLabelId", "phoneKey")`,
  `CREATE INDEX IF NOT EXISTS "MktContact_whiteLabelId_email_idx" ON "MktContact"("whiteLabelId", "email")`,
  `CREATE INDEX IF NOT EXISTS "MktContact_whiteLabelId_deleted_idx" ON "MktContact"("whiteLabelId", "deleted")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "MktContact_wl_phoneNorm_uq" ON "MktContact"("whiteLabelId", "phoneNorm") WHERE "phoneNorm" IS NOT NULL AND NOT "deleted"`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "MktContact_wl_email_uq" ON "MktContact"("whiteLabelId", "email") WHERE "email" IS NOT NULL AND NOT "deleted"`,
];

(async () => {
  const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
  if (!url) { console.error('No DATABASE_URL'); process.exit(1); }
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  const name = '20260904_add_mkt_contact';

  for (const sql of DDL) await prisma.$executeRawUnsafe(sql);

  const tbl = await prisma.$queryRawUnsafe(
    `SELECT 1 FROM information_schema.tables WHERE table_name='MktContact'`);
  console.log('• MktContact:', tbl.length ? '✓ tabla creada' : 'FALTA ✗');

  const idx = await prisma.$queryRawUnsafe(
    `SELECT indexname FROM pg_indexes WHERE tablename='MktContact' ORDER BY indexname`);
  console.log('• Índices:', idx.map((r) => r.indexname).join(', '));
  const hasUq = idx.some((r) => r.indexname === 'MktContact_wl_phoneNorm_uq');
  console.log('• Índice único parcial phoneNorm:', hasUq ? '✓' : 'FALTA ✗');

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
