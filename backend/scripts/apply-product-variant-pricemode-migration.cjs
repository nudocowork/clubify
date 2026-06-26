// Migración 20260818_product_variant_price_mode: agrega a Product el campo
// variantPriceMode (TEXT NOT NULL DEFAULT 'DELTA'). Controla si las variantes
// del producto SUMAN al base ('DELTA', histórico) o definen su PRECIO PROPIO
// total ('ABSOLUTE', tamaños tipo Pequeña/Mediana/Grande con precio fijo).
// Idempotente (ADD COLUMN IF NOT EXISTS) + registra en _prisma_migrations.
// Correr ANTES de deployar el backend nuevo.
// Usage: railway run --service Postgres-Nq8w node /ABS/PATH/backend/scripts/apply-product-variant-pricemode-migration.cjs
const { PrismaClient } = require('@prisma/client');
const crypto = require('crypto');

(async () => {
  const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
  if (!url) {
    console.error('No DATABASE_URL');
    process.exit(1);
  }
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  const name = '20260818_product_variant_price_mode';

  const statements = [
    `ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "variantPriceMode" TEXT NOT NULL DEFAULT 'DELTA'`,
  ];
  for (const st of statements) {
    await prisma.$executeRawUnsafe(st);
  }
  console.log(`✅ DDL aplicado (${statements.length} sentencia, idempotente).`);

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
