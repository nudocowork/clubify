// Reconcilia el schema de HotmartCreditPurchase con el modelo Prisma actual.
// La tabla existía de una sesión anterior con columnas diferentes:
//   prod:  linkId, productId, sin status, sin assignedAt, + offerCode/amount/currency
//   schema: creditLinkId, hotmartProductId, + status + assignedAt
//
// Plan:
//   1. Verificar columnas existentes
//   2. Rename linkId → creditLinkId
//   3. Rename productId → hotmartProductId
//   4. ADD status (default UNASSIGNED, backfill ASSIGNED where whiteLabelId is set)
//   5. ADD assignedAt (backfill = createdAt where whiteLabelId is set)
//   6. Relax NOT NULL en offerCode/amount/currency (mi Prisma no los conoce)
//   7. Crear índice status
//
// Idempotente. Usage:
//   railway run --service Postgres-Nq8w node \
//     /Users/jhonarias/Documents/AGENTES/CLUBIFY/backend/scripts/fix-hotmart-credit-purchase-schema.cjs

const { PrismaClient } = require('@prisma/client');

async function safe(prisma, label, fn) {
  try {
    await fn();
    console.log(`✓ ${label}`);
  } catch (e) {
    const msg = String(e.message || e);
    console.log(`⚠ ${label}: ${msg.slice(0, 120)}`);
  }
}

(async () => {
  const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
  if (!url) { console.error('No DATABASE_URL'); process.exit(1); }
  const prisma = new PrismaClient({ datasources: { db: { url } } });

  const cols = await prisma.$queryRawUnsafe(
    `SELECT column_name, is_nullable FROM information_schema.columns WHERE table_name='HotmartCreditPurchase' ORDER BY column_name`,
  );
  const colMap = new Map(cols.map((c) => [c.column_name, c.is_nullable]));
  console.log(`Columnas actuales: ${cols.length}`);

  // 1) Rename linkId → creditLinkId (si linkId existe y creditLinkId no)
  if (colMap.has('linkId') && !colMap.has('creditLinkId')) {
    await safe(prisma, 'Rename linkId → creditLinkId', async () => {
      await prisma.$executeRawUnsafe(`ALTER TABLE "HotmartCreditPurchase" RENAME COLUMN "linkId" TO "creditLinkId"`);
    });
  } else {
    console.log(`✓ creditLinkId ya nombrado correctamente`);
  }

  // 2) Rename productId → hotmartProductId
  if (colMap.has('productId') && !colMap.has('hotmartProductId')) {
    await safe(prisma, 'Rename productId → hotmartProductId', async () => {
      await prisma.$executeRawUnsafe(`ALTER TABLE "HotmartCreditPurchase" RENAME COLUMN "productId" TO "hotmartProductId"`);
    });
  } else {
    console.log(`✓ hotmartProductId ya nombrado correctamente`);
  }

  // 3) ADD status
  if (!colMap.has('status')) {
    await safe(prisma, 'ADD COLUMN status', async () => {
      await prisma.$executeRawUnsafe(`ALTER TABLE "HotmartCreditPurchase" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'UNASSIGNED'`);
    });
    await safe(prisma, 'Backfill status=ASSIGNED para rows con whiteLabelId', async () => {
      await prisma.$executeRawUnsafe(`UPDATE "HotmartCreditPurchase" SET "status" = 'ASSIGNED' WHERE "whiteLabelId" IS NOT NULL`);
    });
  } else {
    console.log(`✓ status ya existe`);
  }

  // 4) ADD assignedAt
  if (!colMap.has('assignedAt')) {
    await safe(prisma, 'ADD COLUMN assignedAt', async () => {
      await prisma.$executeRawUnsafe(`ALTER TABLE "HotmartCreditPurchase" ADD COLUMN "assignedAt" TIMESTAMP(3)`);
    });
    await safe(prisma, 'Backfill assignedAt=createdAt para rows con whiteLabelId', async () => {
      await prisma.$executeRawUnsafe(`UPDATE "HotmartCreditPurchase" SET "assignedAt" = "createdAt" WHERE "whiteLabelId" IS NOT NULL`);
    });
  } else {
    console.log(`✓ assignedAt ya existe`);
  }

  // 5) Relax NOT NULL en columnas extras que mi Prisma no conoce
  for (const extra of ['offerCode', 'amount', 'currency']) {
    if (colMap.get(extra) === 'NO') {
      await safe(prisma, `Relax NOT NULL ${extra}`, async () => {
        await prisma.$executeRawUnsafe(`ALTER TABLE "HotmartCreditPurchase" ALTER COLUMN "${extra}" DROP NOT NULL`);
      });
    }
  }

  // 6) Crear índice status si no existe
  const idx = await prisma.$queryRawUnsafe(
    `SELECT indexname FROM pg_indexes WHERE tablename='HotmartCreditPurchase' AND indexname='HotmartCreditPurchase_status_idx'`,
  );
  if (idx.length === 0) {
    await safe(prisma, 'CREATE INDEX status', async () => {
      await prisma.$executeRawUnsafe(`CREATE INDEX "HotmartCreditPurchase_status_idx" ON "HotmartCreditPurchase"("status")`);
    });
  } else {
    console.log(`✓ Index status ya existe`);
  }

  // 7) Verificación final
  const finalCols = await prisma.$queryRawUnsafe(
    `SELECT column_name, is_nullable FROM information_schema.columns WHERE table_name='HotmartCreditPurchase' ORDER BY ordinal_position`,
  );
  console.log('\nColumnas finales:');
  finalCols.forEach((c) => console.log(`  · ${c.column_name} (nullable=${c.is_nullable})`));

  console.log('\nDone.');
  process.exit(0);
})().catch((e) => {
  console.error('FAIL', e);
  process.exit(1);
});
