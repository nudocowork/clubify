// Aplica la migration 20260824_infolink_business_type a prod sin downtime.
// - Enum BusinessType (FULL/INFOLINK)
// - Tenant.businessType (default FULL → todos los negocios existentes quedan Completo)
// - Créditos de WhiteLabel + CreditTransaction.amount → double precision (fracciones 0.25)
// Idempotente. Usage:
//   railway run --service Postgres-Nq8w node scripts/apply-infolink-business-type-migration.cjs
const { PrismaClient } = require('@prisma/client');

const MIGRATION_NAME = '20260824_infolink_business_type';

(async () => {
  const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
  if (!url) {
    console.error('No DATABASE_URL');
    process.exit(1);
  }
  const prisma = new PrismaClient({ datasources: { db: { url } } });

  // 1) Enum BusinessType
  const enumExists = await prisma.$queryRawUnsafe(
    `SELECT 1 FROM pg_type WHERE typname = 'BusinessType'`,
  );
  if (enumExists.length === 0) {
    console.log('→ Creando enum BusinessType…');
    await prisma.$executeRawUnsafe(
      `CREATE TYPE "BusinessType" AS ENUM ('FULL', 'INFOLINK')`,
    );
    console.log('✓ enum BusinessType creado');
  } else {
    console.log('✓ enum BusinessType ya existe — skip');
  }

  // 2) Tenant.businessType
  const col = await prisma.$queryRawUnsafe(
    `SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'Tenant' AND column_name = 'businessType'`,
  );
  if (col.length === 0) {
    console.log('→ Creando Tenant.businessType…');
    await prisma.$executeRawUnsafe(
      `ALTER TABLE "Tenant" ADD COLUMN "businessType" "BusinessType" NOT NULL DEFAULT 'FULL'`,
    );
    console.log('✓ Tenant.businessType listo (todos = FULL)');
  } else {
    console.log('✓ Tenant.businessType ya existe — skip');
  }

  // 3) Créditos a double precision (idempotente: solo altera si aún es integer)
  const numCols = await prisma.$queryRawUnsafe(
    `SELECT table_name, column_name, data_type FROM information_schema.columns
      WHERE table_schema = 'public'
        AND ((table_name = 'WhiteLabel' AND column_name IN ('creditsAvailable','creditsCommitted','creditsUsed'))
          OR (table_name = 'CreditTransaction' AND column_name = 'amount'))`,
  );
  const targets = [
    ['WhiteLabel', 'creditsAvailable'],
    ['WhiteLabel', 'creditsCommitted'],
    ['WhiteLabel', 'creditsUsed'],
    ['CreditTransaction', 'amount'],
  ];
  for (const [table, column] of targets) {
    const cur = numCols.find(
      (c) => c.table_name === table && c.column_name === column,
    );
    if (cur && cur.data_type !== 'double precision') {
      console.log(`→ ${table}.${column} (${cur.data_type}) → double precision…`);
      await prisma.$executeRawUnsafe(
        `ALTER TABLE "${table}" ALTER COLUMN "${column}" SET DATA TYPE double precision`,
      );
      console.log(`✓ ${table}.${column} listo`);
    } else {
      console.log(`✓ ${table}.${column} ya es double precision — skip`);
    }
  }

  // 4) Marcar la migration como aplicada
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
