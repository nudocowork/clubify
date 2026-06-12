// Aplica migration 20260612_tenant_soft_delete a prod.
// Usage: railway run --service Postgres-Nq8w node scripts/apply-tenant-soft-delete-migration.cjs
const { PrismaClient } = require('@prisma/client');

const MIGRATION_NAME = '20260612_tenant_soft_delete';

(async () => {
  const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
  if (!url) {
    console.error('No DATABASE_URL');
    process.exit(1);
  }
  const prisma = new PrismaClient({ datasources: { db: { url } } });

  const cols = await prisma.$queryRawUnsafe(
    `SELECT column_name FROM information_schema.columns
      WHERE table_schema='public' AND table_name='Tenant' AND column_name='deletedAt'`,
  );
  if (cols.length === 0) {
    console.log('→ Creando Tenant.deletedAt…');
    await prisma.$executeRawUnsafe(
      `ALTER TABLE "Tenant" ADD COLUMN "deletedAt" TIMESTAMP(3)`,
    );
    console.log('✓ deletedAt creado');
  } else {
    console.log('✓ deletedAt ya existe — skip');
  }

  const idx = await prisma.$queryRawUnsafe(
    `SELECT indexname FROM pg_indexes WHERE schemaname='public' AND indexname='Tenant_deletedAt_idx'`,
  );
  if (idx.length === 0) {
    console.log('→ Creando índice…');
    await prisma.$executeRawUnsafe(
      `CREATE INDEX "Tenant_deletedAt_idx" ON "Tenant"("deletedAt")`,
    );
    console.log('✓ Índice creado');
  } else {
    console.log('✓ Índice ya existe — skip');
  }

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
