// Aplica la migration 20260613_hotmart_credit_purchase a prod.
// Usage: railway run --service Postgres-Nq8w node scripts/apply-hotmart-credit-purchase-migration.cjs
const { PrismaClient } = require('@prisma/client');

const MIGRATION_NAME = '20260613_hotmart_credit_purchase';

async function tryExec(prisma, sql, label) {
  try {
    await prisma.$executeRawUnsafe(sql);
    console.log(`✓ ${label}`);
  } catch (e) {
    const msg = String(e.message || e);
    if (msg.includes('already exists') || msg.includes('duplicate')) {
      console.log(`✓ ${label} (ya existía)`);
    } else {
      throw e;
    }
  }
}

(async () => {
  const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
  if (!url) { console.error('No DATABASE_URL'); process.exit(1); }
  const prisma = new PrismaClient({ datasources: { db: { url } } });

  // 1) HotmartCreditLink columnas nuevas
  const col1 = await prisma.$queryRawUnsafe(
    `SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='HotmartCreditLink' AND column_name='productId'`,
  );
  if (col1.length === 0) {
    await prisma.$executeRawUnsafe(`ALTER TABLE "HotmartCreditLink" ADD COLUMN "productId" TEXT`);
    console.log('✓ HotmartCreditLink.productId');
  } else {
    console.log('✓ HotmartCreditLink.productId ya existe');
  }
  const col2 = await prisma.$queryRawUnsafe(
    `SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='HotmartCreditLink' AND column_name='offerCode'`,
  );
  if (col2.length === 0) {
    await prisma.$executeRawUnsafe(`ALTER TABLE "HotmartCreditLink" ADD COLUMN "offerCode" TEXT`);
    console.log('✓ HotmartCreditLink.offerCode');
  } else {
    console.log('✓ HotmartCreditLink.offerCode ya existe');
  }
  await tryExec(prisma, `CREATE INDEX "HotmartCreditLink_productId_idx" ON "HotmartCreditLink"("productId")`, 'Index HotmartCreditLink_productId');

  // 2) HotmartCreditPurchase tabla
  await tryExec(prisma, `CREATE TABLE "HotmartCreditPurchase" (
    "id" TEXT NOT NULL,
    "linkId" TEXT,
    "whiteLabelId" TEXT,
    "buyerEmail" TEXT NOT NULL,
    "productId" TEXT,
    "offerCode" TEXT,
    "credits" INTEGER NOT NULL,
    "amount" DECIMAL(12,2),
    "currency" TEXT NOT NULL DEFAULT 'MXN',
    "transactionId" TEXT NOT NULL,
    "rawPayload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "HotmartCreditPurchase_pkey" PRIMARY KEY ("id")
  )`, 'Tabla HotmartCreditPurchase');
  await tryExec(prisma, `CREATE UNIQUE INDEX "HotmartCreditPurchase_transactionId_key" ON "HotmartCreditPurchase"("transactionId")`, 'Index unique tx');
  await tryExec(prisma, `CREATE INDEX "HotmartCreditPurchase_whiteLabelId_createdAt_idx" ON "HotmartCreditPurchase"("whiteLabelId", "createdAt")`, 'Index whiteLabel');
  await tryExec(prisma, `CREATE INDEX "HotmartCreditPurchase_buyerEmail_idx" ON "HotmartCreditPurchase"("buyerEmail")`, 'Index buyerEmail');
  await tryExec(prisma, `ALTER TABLE "HotmartCreditPurchase" ADD CONSTRAINT "HotmartCreditPurchase_linkId_fkey" FOREIGN KEY ("linkId") REFERENCES "HotmartCreditLink"("id") ON DELETE SET NULL ON UPDATE CASCADE`, 'FK linkId');

  // 3) Marcar migration
  const exists = await prisma.$queryRawUnsafe(
    `SELECT id FROM _prisma_migrations WHERE migration_name = $1`, MIGRATION_NAME,
  );
  if (exists.length === 0) {
    await prisma.$executeRawUnsafe(
      `INSERT INTO _prisma_migrations (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
       VALUES (gen_random_uuid()::text, 'manual-apply-' || extract(epoch from now())::text, NOW(), $1, NULL, NULL, NOW(), 1)`,
      MIGRATION_NAME,
    );
    console.log(`✓ Migration ${MIGRATION_NAME} marcada`);
  } else {
    console.log(`✓ Migration ${MIGRATION_NAME} ya marcada`);
  }

  await prisma.$disconnect();
  console.log('\n✅ Listo.');
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
