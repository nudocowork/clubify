// Aplica la migration 20260612_pending_hotmart_team_reminder a prod
// sin downtime. Idempotente — chequea si la columna ya existe antes de
// crearla, y SELECT-then-INSERT en _prisma_migrations.
// Usage: railway run --service Postgres-Nq8w node scripts/apply-team-reminder-migration.cjs
const { PrismaClient } = require('@prisma/client');

const MIGRATION_NAME = '20260612_pending_hotmart_team_reminder';

(async () => {
  const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
  if (!url) {
    console.error('No DATABASE_URL');
    process.exit(1);
  }
  const masked = url.replace(/:\/\/[^@]+@/, '://***:***@');
  console.log('Connecting to:', masked);
  const prisma = new PrismaClient({ datasources: { db: { url } } });

  // 1) ¿Columna ya existe?
  const cols = await prisma.$queryRawUnsafe(
    `SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'PendingHotmartPayment'
        AND column_name = 'teamReminderSentAt'`,
  );
  if (cols.length > 0) {
    console.log('✓ Columna teamReminderSentAt ya existe — skip ALTER TABLE');
  } else {
    console.log('→ Creando columna teamReminderSentAt…');
    await prisma.$executeRawUnsafe(
      `ALTER TABLE "PendingHotmartPayment" ADD COLUMN "teamReminderSentAt" TIMESTAMP(3)`,
    );
    console.log('✓ ALTER TABLE listo');
  }

  // 2) ¿Índice ya existe?
  const idx = await prisma.$queryRawUnsafe(
    `SELECT indexname FROM pg_indexes
      WHERE schemaname='public'
        AND indexname='PendingHotmartPayment_teamReminderSentAt_idx'`,
  );
  if (idx.length > 0) {
    console.log('✓ Índice ya existe — skip');
  } else {
    console.log('→ Creando índice…');
    await prisma.$executeRawUnsafe(
      `CREATE INDEX "PendingHotmartPayment_teamReminderSentAt_idx" ON "PendingHotmartPayment"("teamReminderSentAt")`,
    );
    console.log('✓ Índice listo');
  }

  // 3) Marcar migration aplicada en _prisma_migrations (sin unique
  //    constraint en migration_name → SELECT-then-INSERT).
  const exists = await prisma.$queryRawUnsafe(
    `SELECT id FROM _prisma_migrations WHERE migration_name = $1`,
    MIGRATION_NAME,
  );
  if (exists.length > 0) {
    console.log(`✓ Migration ${MIGRATION_NAME} ya marcada — skip INSERT`);
  } else {
    await prisma.$executeRawUnsafe(
      `INSERT INTO _prisma_migrations (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
       VALUES (gen_random_uuid()::text, 'manual-apply-' || extract(epoch from now())::text, NOW(), $1, NULL, NULL, NOW(), 1)`,
      MIGRATION_NAME,
    );
    console.log(`✓ Migration ${MIGRATION_NAME} marcada como aplicada`);
  }

  await prisma.$disconnect();
  console.log('\n✅ Listo.');
})().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});
