// Migración 20260724000000_add_sync_fields_ju1053 (Onboarding Sync Fase 3):
//   - Tenant.tiktokUrl / websiteUrl / city  (redes + ubicación del negocio)
//   - Card.couponCode / couponQuantity       (cupón con código + cantidad)
// Idempotente (IF NOT EXISTS). Correr ANTES de deployar el backend nuevo.
//   railway run --service Postgres-Nq8w node scripts/apply-sync-fields-migration.cjs
const { PrismaClient } = require('@prisma/client');
const crypto = require('crypto');
(async () => {
  const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
  if (!url) { console.error('No DATABASE_URL'); process.exit(1); }
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  const name = '20260724000000_add_sync_fields_ju1053';

  const stmts = [
    `ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "tiktokUrl" TEXT`,
    `ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "websiteUrl" TEXT`,
    `ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "city" TEXT`,
    `ALTER TABLE "Card" ADD COLUMN IF NOT EXISTS "couponCode" TEXT`,
    `ALTER TABLE "Card" ADD COLUMN IF NOT EXISTS "couponQuantity" INTEGER`,
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
