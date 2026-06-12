// Aplica la migration 20260612_support_material_vendor a prod.
// Usage: railway run --service Postgres-Nq8w node scripts/apply-support-vendor-migration.cjs
const { PrismaClient } = require('@prisma/client');

const MIGRATION_NAME = '20260612_support_material_vendor';

(async () => {
  const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
  if (!url) {
    console.error('No DATABASE_URL');
    process.exit(1);
  }
  const prisma = new PrismaClient({ datasources: { db: { url } } });

  // ADD VALUE IF NOT EXISTS no requiere transacción explícita.
  // Tiramos un solo SQL — Postgres lo ignora si el value ya existe.
  console.log('→ ADD VALUE VENDOR / ALL al enum SupportMaterialAudience…');
  try {
    await prisma.$executeRawUnsafe(
      `ALTER TYPE "SupportMaterialAudience" ADD VALUE IF NOT EXISTS 'VENDOR'`,
    );
    await prisma.$executeRawUnsafe(
      `ALTER TYPE "SupportMaterialAudience" ADD VALUE IF NOT EXISTS 'ALL'`,
    );
    console.log('✓ Enum actualizado');
  } catch (e) {
    console.error('ALTER TYPE falló:', e.message);
    throw e;
  }

  const exists = await prisma.$queryRawUnsafe(
    `SELECT id FROM _prisma_migrations WHERE migration_name = $1`,
    MIGRATION_NAME,
  );
  if (exists.length > 0) {
    console.log(`✓ Migration ${MIGRATION_NAME} ya marcada — skip`);
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
