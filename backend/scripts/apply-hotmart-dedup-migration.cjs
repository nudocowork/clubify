// Aplica la migration 20260612_hotmart_event_dedup a prod.
// Usage: railway run --service Postgres-Nq8w node scripts/apply-hotmart-dedup-migration.cjs
const { PrismaClient } = require('@prisma/client');

const MIGRATION_NAME = '20260612_hotmart_event_dedup';

(async () => {
  const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
  if (!url) {
    console.error('No DATABASE_URL');
    process.exit(1);
  }
  const prisma = new PrismaClient({ datasources: { db: { url } } });

  // 1) Tenant.lastChargeAt
  const lcaCol = await prisma.$queryRawUnsafe(
    `SELECT column_name FROM information_schema.columns
      WHERE table_schema='public' AND table_name='Tenant' AND column_name='lastChargeAt'`,
  );
  if (lcaCol.length === 0) {
    console.log('→ Tenant.lastChargeAt…');
    await prisma.$executeRawUnsafe(
      `ALTER TABLE "Tenant" ADD COLUMN "lastChargeAt" TIMESTAMP(3)`,
    );
    console.log('✓ lastChargeAt creado');
  } else {
    console.log('✓ lastChargeAt ya existe — skip');
  }

  // 2) Tabla HotmartWebhookEvent
  const tbl = await prisma.$queryRawUnsafe(
    `SELECT table_name FROM information_schema.tables
      WHERE table_schema='public' AND table_name='HotmartWebhookEvent'`,
  );
  if (tbl.length === 0) {
    console.log('→ Tabla HotmartWebhookEvent + índices…');
    await prisma.$executeRawUnsafe(`
      CREATE TABLE "HotmartWebhookEvent" (
        "id" TEXT NOT NULL,
        "eventId" TEXT NOT NULL,
        "eventType" TEXT NOT NULL,
        "tenantId" TEXT,
        "payload" JSONB NOT NULL,
        "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "HotmartWebhookEvent_pkey" PRIMARY KEY ("id")
      )
    `);
    await prisma.$executeRawUnsafe(
      `CREATE UNIQUE INDEX "HotmartWebhookEvent_eventId_key" ON "HotmartWebhookEvent"("eventId")`,
    );
    await prisma.$executeRawUnsafe(
      `CREATE INDEX "HotmartWebhookEvent_tenantId_eventType_processedAt_idx" ON "HotmartWebhookEvent"("tenantId", "eventType", "processedAt")`,
    );
    console.log('✓ Tabla creada');
  } else {
    console.log('✓ HotmartWebhookEvent ya existe — skip');
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
