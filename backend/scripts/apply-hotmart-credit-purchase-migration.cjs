// Aplica la migration 20260614_hotmart_credit_purchase a prod.
// 1) Agrega HotmartCreditLink.hotmartProductId + índice
// 2) Crea tabla HotmartCreditPurchase + FKs + índices
// Usage (path absoluto, ver feedback_railway_run_cwd_path_quirk):
//   railway run --service Postgres-Nq8w node \
//     /Users/jhonarias/Documents/AGENTES/CLUBIFY/backend/scripts/apply-hotmart-credit-purchase-migration.cjs
const { PrismaClient } = require('@prisma/client');

const MIGRATION_NAME = '20260614_hotmart_credit_purchase';

async function tryExec(prisma, sql, label) {
  try {
    await prisma.$executeRawUnsafe(sql);
    console.log(`✓ ${label}`);
  } catch (e) {
    const msg = String(e.message || e);
    if (msg.includes('already exists') || msg.includes('duplicate') || msg.includes('does not exist')) {
      console.log(`✓ ${label} (skip: ${msg.slice(0, 80)}…)`);
    } else {
      throw e;
    }
  }
}

(async () => {
  const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
  if (!url) { console.error('No DATABASE_URL'); process.exit(1); }
  const prisma = new PrismaClient({ datasources: { db: { url } } });

  // 1) Agregar columna hotmartProductId a HotmartCreditLink
  const colCheck = await prisma.$queryRawUnsafe(
    `SELECT column_name FROM information_schema.columns WHERE table_name='HotmartCreditLink' AND column_name='hotmartProductId'`,
  );
  if (colCheck.length === 0) {
    await prisma.$executeRawUnsafe(`ALTER TABLE "HotmartCreditLink" ADD COLUMN "hotmartProductId" TEXT`);
    console.log('✓ HotmartCreditLink.hotmartProductId agregado');
  } else {
    console.log('✓ HotmartCreditLink.hotmartProductId ya existía');
  }

  await tryExec(prisma, `CREATE INDEX "HotmartCreditLink_hotmartProductId_idx" ON "HotmartCreditLink"("hotmartProductId")`, 'Index HotmartCreditLink.hotmartProductId');

  // 2) Tabla HotmartCreditPurchase
  await tryExec(prisma, `CREATE TABLE "HotmartCreditPurchase" (
    "id" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "hotmartProductId" TEXT NOT NULL,
    "creditLinkId" TEXT,
    "credits" INTEGER NOT NULL,
    "buyerEmail" TEXT NOT NULL,
    "whiteLabelId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'UNASSIGNED',
    "rawPayload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "assignedAt" TIMESTAMP(3),
    CONSTRAINT "HotmartCreditPurchase_pkey" PRIMARY KEY ("id")
  )`, 'Tabla HotmartCreditPurchase');

  await tryExec(prisma, `CREATE UNIQUE INDEX "HotmartCreditPurchase_transactionId_key" ON "HotmartCreditPurchase"("transactionId")`, 'Index unique transactionId');
  await tryExec(prisma, `CREATE INDEX "HotmartCreditPurchase_status_idx" ON "HotmartCreditPurchase"("status")`, 'Index status');
  await tryExec(prisma, `CREATE INDEX "HotmartCreditPurchase_whiteLabelId_idx" ON "HotmartCreditPurchase"("whiteLabelId")`, 'Index whiteLabelId');
  await tryExec(prisma, `CREATE INDEX "HotmartCreditPurchase_buyerEmail_idx" ON "HotmartCreditPurchase"("buyerEmail")`, 'Index buyerEmail');

  await tryExec(prisma, `ALTER TABLE "HotmartCreditPurchase" ADD CONSTRAINT "HotmartCreditPurchase_creditLinkId_fkey" FOREIGN KEY ("creditLinkId") REFERENCES "HotmartCreditLink"("id") ON DELETE SET NULL ON UPDATE CASCADE`, 'FK creditLinkId');
  await tryExec(prisma, `ALTER TABLE "HotmartCreditPurchase" ADD CONSTRAINT "HotmartCreditPurchase_whiteLabelId_fkey" FOREIGN KEY ("whiteLabelId") REFERENCES "WhiteLabel"("id") ON DELETE SET NULL ON UPDATE CASCADE`, 'FK whiteLabelId');

  // Registrar en _prisma_migrations si no existe
  const existing = await prisma.$queryRawUnsafe(
    `SELECT id FROM "_prisma_migrations" WHERE migration_name = $1`,
    MIGRATION_NAME,
  );
  if (existing.length === 0) {
    await prisma.$executeRawUnsafe(
      `INSERT INTO "_prisma_migrations" (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
       VALUES (gen_random_uuid()::text, 'manual', now(), $1, NULL, NULL, now(), 1)`,
      MIGRATION_NAME,
    );
    console.log('✓ Registrado en _prisma_migrations');
  } else {
    console.log('✓ Ya estaba registrado en _prisma_migrations');
  }

  console.log('\nDone.');
  process.exit(0);
})().catch((e) => {
  console.error('FAIL', e);
  process.exit(1);
});
