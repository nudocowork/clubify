// Aplica la migration 20260612_recurring_notifications a prod.
// Usage: railway run --service Postgres-Nq8w node scripts/apply-recurring-notifications-migration.cjs
const { PrismaClient } = require('@prisma/client');

const MIGRATION_NAME = '20260612_recurring_notifications';

(async () => {
  const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
  if (!url) {
    console.error('No DATABASE_URL');
    process.exit(1);
  }
  const prisma = new PrismaClient({ datasources: { db: { url } } });

  const tbl = await prisma.$queryRawUnsafe(
    `SELECT table_name FROM information_schema.tables
      WHERE table_schema='public' AND table_name='RecurringNotification'`,
  );
  if (tbl.length === 0) {
    console.log('→ Tabla RecurringNotification…');
    await prisma.$executeRawUnsafe(`
      CREATE TABLE "RecurringNotification" (
        "id" TEXT NOT NULL,
        "tenantId" TEXT NOT NULL,
        "cardId" TEXT,
        "title" TEXT NOT NULL,
        "body" TEXT NOT NULL,
        "segment" JSONB,
        "daysOfWeek" INTEGER[] NOT NULL,
        "timeOfDay" TEXT NOT NULL,
        "timezone" TEXT NOT NULL DEFAULT 'America/Bogota',
        "isActive" BOOLEAN NOT NULL DEFAULT true,
        "lastDispatchedAt" TIMESTAMP(3),
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL,
        CONSTRAINT "RecurringNotification_pkey" PRIMARY KEY ("id")
      )
    `);
    await prisma.$executeRawUnsafe(
      `CREATE INDEX "RecurringNotification_tenantId_isActive_idx" ON "RecurringNotification"("tenantId", "isActive")`,
    );
    await prisma.$executeRawUnsafe(
      `ALTER TABLE "RecurringNotification" ADD CONSTRAINT "RecurringNotification_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await prisma.$executeRawUnsafe(
      `ALTER TABLE "RecurringNotification" ADD CONSTRAINT "RecurringNotification_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "Card"("id") ON DELETE SET NULL ON UPDATE CASCADE`,
    );
    console.log('✓ Tabla creada');
  } else {
    console.log('✓ RecurringNotification ya existe — skip');
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
