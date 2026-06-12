// Aplica la migration 20260612_product_category_nullable a prod.
// Usage: railway run --service Postgres-Nq8w node scripts/apply-product-category-nullable-migration.cjs
const { PrismaClient } = require('@prisma/client');

const MIGRATION_NAME = '20260612_product_category_nullable';

(async () => {
  const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
  if (!url) {
    console.error('No DATABASE_URL');
    process.exit(1);
  }
  const prisma = new PrismaClient({ datasources: { db: { url } } });

  // 1) DROP NOT NULL
  const colInfo = await prisma.$queryRawUnsafe(
    `SELECT is_nullable FROM information_schema.columns
      WHERE table_schema='public' AND table_name='Product' AND column_name='categoryId'`,
  );
  if (colInfo[0]?.is_nullable === 'NO') {
    console.log('→ Product.categoryId DROP NOT NULL…');
    await prisma.$executeRawUnsafe(
      `ALTER TABLE "Product" ALTER COLUMN "categoryId" DROP NOT NULL`,
    );
    console.log('✓ categoryId ahora nullable');
  } else {
    console.log('✓ categoryId ya era nullable — skip');
  }

  // 2) Recrear FK con SetNull
  const fkInfo = await prisma.$queryRawUnsafe(
    `SELECT confdeltype FROM pg_constraint
      WHERE conname = 'Product_categoryId_fkey'`,
  );
  // confdeltype: 'c' = Cascade, 'n' = SetNull, 'a' = NoAction, 'r' = Restrict
  if (!fkInfo[0] || fkInfo[0].confdeltype !== 'n') {
    console.log('→ Recreando FK con SetNull…');
    await prisma.$executeRawUnsafe(
      `ALTER TABLE "Product" DROP CONSTRAINT IF EXISTS "Product_categoryId_fkey"`,
    );
    await prisma.$executeRawUnsafe(`
      ALTER TABLE "Product"
        ADD CONSTRAINT "Product_categoryId_fkey"
        FOREIGN KEY ("categoryId") REFERENCES "Category"("id")
        ON DELETE SET NULL ON UPDATE CASCADE
    `);
    console.log('✓ FK recreada con SetNull');
  } else {
    console.log('✓ FK ya tiene SetNull — skip');
  }

  // 3) Marcar migration
  const exists = await prisma.$queryRawUnsafe(
    `SELECT id FROM _prisma_migrations WHERE migration_name = $1`,
    MIGRATION_NAME,
  );
  if (exists.length > 0) {
    console.log(`✓ Migration ${MIGRATION_NAME} ya marcada`);
  } else {
    await prisma.$executeRawUnsafe(
      `INSERT INTO _prisma_migrations (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
       VALUES (gen_random_uuid()::text, 'manual-apply-' || extract(epoch from now())::text, NOW(), $1, NULL, NULL, NOW(), 1)`,
      MIGRATION_NAME,
    );
    console.log(`✓ Migration ${MIGRATION_NAME} marcada`);
  }

  await prisma.$disconnect();
  console.log('\n✅ Listo.');
})().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});
