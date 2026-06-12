// Aplica la migration 20260612_tenant_academy_flags a prod sin downtime.
// Usage: railway run --service Postgres-Nq8w node scripts/apply-academy-flags-migration.cjs
const { PrismaClient } = require('@prisma/client');

const MIGRATION_NAME = '20260612_tenant_academy_flags';

(async () => {
  const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
  if (!url) {
    console.error('No DATABASE_URL');
    process.exit(1);
  }
  const prisma = new PrismaClient({ datasources: { db: { url } } });

  const cols = await prisma.$queryRawUnsafe(
    `SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'Tenant'
        AND column_name IN ('tutorialsEnabled', 'academyEnabled')`,
  );
  const hasT = cols.find((c) => c.column_name === 'tutorialsEnabled');
  const hasA = cols.find((c) => c.column_name === 'academyEnabled');

  if (!hasT) {
    console.log('→ Creando tutorialsEnabled…');
    await prisma.$executeRawUnsafe(
      `ALTER TABLE "Tenant" ADD COLUMN "tutorialsEnabled" BOOLEAN NOT NULL DEFAULT TRUE`,
    );
    console.log('✓ tutorialsEnabled listo');
  } else {
    console.log('✓ tutorialsEnabled ya existe — skip');
  }
  if (!hasA) {
    console.log('→ Creando academyEnabled…');
    await prisma.$executeRawUnsafe(
      `ALTER TABLE "Tenant" ADD COLUMN "academyEnabled" BOOLEAN NOT NULL DEFAULT TRUE`,
    );
    console.log('✓ academyEnabled listo');
  } else {
    console.log('✓ academyEnabled ya existe — skip');
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
