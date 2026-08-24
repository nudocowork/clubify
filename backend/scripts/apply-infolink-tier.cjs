// Aplica 20260822_add_infolink_tier (enum InfolinkTier + columna Tenant.infolinkTier
// + backfill INFOLINK existentes → PRO) y la registra en _prisma_migrations.
// Aditivo + idempotente. Correr ANTES del deploy del backend que la usa.
// Usage: railway run --service Postgres-Nq8w node scripts/apply-infolink-tier.cjs
const { PrismaClient } = require('@prisma/client');
const crypto = require('crypto');

const DDL = [
  `DO $$ BEGIN
     IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'InfolinkTier') THEN
       CREATE TYPE "InfolinkTier" AS ENUM ('FREE', 'PRO');
     END IF;
   END $$`,
  `ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "infolinkTier" "InfolinkTier"`,
  `UPDATE "Tenant" SET "infolinkTier" = 'PRO'
     WHERE "businessType" = 'INFOLINK' AND "infolinkTier" IS NULL`,
];

(async () => {
  const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
  if (!url) { console.error('No DATABASE_URL'); process.exit(1); }
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  const name = '20260822_add_infolink_tier';

  for (const sql of DDL) await prisma.$executeRawUnsafe(sql);

  const col = await prisma.$queryRawUnsafe(
    `SELECT 1 FROM information_schema.columns
     WHERE table_name='Tenant' AND column_name='infolinkTier'`);
  console.log('• Tenant.infolinkTier:', col.length ? '✓ columna presente' : 'FALTA ✗');

  const counts = await prisma.$queryRawUnsafe(
    `SELECT "infolinkTier" AS tier, count(*)::int AS n
       FROM "Tenant" WHERE "businessType"='INFOLINK' GROUP BY 1`);
  console.log('• INFOLINK por tier:', counts.length ? JSON.stringify(counts) : '(sin negocios INFOLINK)');

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
