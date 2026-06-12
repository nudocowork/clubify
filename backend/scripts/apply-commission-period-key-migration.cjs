// Aplica la migration 20260612_commission_period_key_unique a prod.
// Usage: railway run --service Postgres-Nq8w node scripts/apply-commission-period-key-migration.cjs
const { PrismaClient } = require('@prisma/client');

const MIGRATION_NAME = '20260612_commission_period_key_unique';

(async () => {
  const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
  if (!url) {
    console.error('No DATABASE_URL');
    process.exit(1);
  }
  const prisma = new PrismaClient({ datasources: { db: { url } } });

  // 1) Commission.periodKey
  const col = await prisma.$queryRawUnsafe(
    `SELECT column_name FROM information_schema.columns
      WHERE table_schema='public' AND table_name='Commission' AND column_name='periodKey'`,
  );
  if (col.length === 0) {
    console.log('→ Commission.periodKey…');
    await prisma.$executeRawUnsafe(
      `ALTER TABLE "Commission" ADD COLUMN "periodKey" TEXT`,
    );
    console.log('✓ periodKey creado');
  } else {
    console.log('✓ periodKey ya existe — skip');
  }

  // 2) Backfill periodKey desde createdAt para filas con recipientCodeId
  //    NOT NULL. Idempotente — solo updatea rows con periodKey null.
  console.log('→ Backfill periodKey…');
  const backfill = await prisma.$executeRawUnsafe(`
    UPDATE "Commission"
    SET "periodKey" = to_char("createdAt", 'YYYY-MM')
    WHERE "periodKey" IS NULL AND "recipientCodeId" IS NOT NULL
  `);
  console.log(`✓ Backfilled ${backfill} filas`);

  // 3) Antes de crear el UNIQUE INDEX verificamos cero duplicados.
  //    Si hay, abortamos con mensaje claro (no queremos romper migration).
  const dups = await prisma.$queryRawUnsafe(`
    SELECT "referralUseId", "recipientCodeId", "periodKey", COUNT(*)::int AS c
    FROM "Commission"
    WHERE "recipientCodeId" IS NOT NULL AND "periodKey" IS NOT NULL
    GROUP BY "referralUseId", "recipientCodeId", "periodKey"
    HAVING COUNT(*) > 1
    LIMIT 5
  `);
  if (dups.length > 0) {
    console.error(
      `❌ Duplicados detectados — limpiar via /admin/commissions/audit antes de re-correr:\n`,
    );
    for (const d of dups) {
      console.error(
        `   useId=${d.referralUseId} code=${d.recipientCodeId} period=${d.periodKey} count=${d.c}`,
      );
    }
    process.exit(1);
  }
  console.log('✓ Cero duplicados — safe para UNIQUE');

  // 4) UNIQUE INDEX. PostgreSQL trata NULLs como distintos por default,
  //    así que filas legacy con periodKey/recipientCodeId null no chocan.
  const idx = await prisma.$queryRawUnsafe(
    `SELECT indexname FROM pg_indexes
      WHERE schemaname='public' AND tablename='Commission'
        AND indexname='Commission_referralUseId_recipientCodeId_periodKey_key'`,
  );
  if (idx.length === 0) {
    console.log('→ UNIQUE INDEX…');
    await prisma.$executeRawUnsafe(
      `CREATE UNIQUE INDEX "Commission_referralUseId_recipientCodeId_periodKey_key"
        ON "Commission"("referralUseId", "recipientCodeId", "periodKey")`,
    );
    console.log('✓ UNIQUE INDEX creado');
  } else {
    console.log('✓ UNIQUE INDEX ya existe — skip');
  }

  // 5) Marcar migration como aplicada.
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
