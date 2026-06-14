// Verifica que la tabla HotmartCreditPurchase + índices + FKs quedaron OK.
// Usage:
//   railway run --service Postgres-Nq8w node \
//     /Users/jhonarias/Documents/AGENTES/CLUBIFY/backend/scripts/check-hotmart-credit-purchase-table.cjs
const { PrismaClient } = require('@prisma/client');

(async () => {
  const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
  if (!url) { console.error('No DATABASE_URL'); process.exit(1); }
  const prisma = new PrismaClient({ datasources: { db: { url } } });

  const tbl = await prisma.$queryRawUnsafe(
    `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'HotmartCreditPurchase'`,
  );
  console.log(`Tabla HotmartCreditPurchase: ${tbl.length > 0 ? '✓ existe' : '✕ NO existe'}`);

  if (tbl.length === 0) {
    console.log('\n⚠ La tabla no se creó. Re-correr migration con un fix.');
    process.exit(2);
  }

  const cols = await prisma.$queryRawUnsafe(
    `SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'HotmartCreditPurchase' ORDER BY ordinal_position`,
  );
  console.log(`\nColumnas (${cols.length}):`);
  cols.forEach((c) => console.log(`  · ${c.column_name} (${c.data_type})`));

  const idx = await prisma.$queryRawUnsafe(
    `SELECT indexname FROM pg_indexes WHERE tablename = 'HotmartCreditPurchase' ORDER BY indexname`,
  );
  console.log(`\nÍndices (${idx.length}):`);
  idx.forEach((i) => console.log(`  · ${i.indexname}`));

  const fks = await prisma.$queryRawUnsafe(
    `SELECT conname FROM pg_constraint WHERE conrelid = 'public."HotmartCreditPurchase"'::regclass AND contype = 'f'`,
  );
  console.log(`\nFKs (${fks.length}):`);
  fks.forEach((f) => console.log(`  · ${f.conname}`));

  const productIdCol = await prisma.$queryRawUnsafe(
    `SELECT column_name FROM information_schema.columns WHERE table_name = 'HotmartCreditLink' AND column_name = 'hotmartProductId'`,
  );
  console.log(`\nHotmartCreditLink.hotmartProductId: ${productIdCol.length > 0 ? '✓ existe' : '✕ NO existe'}`);

  process.exit(0);
})().catch((e) => {
  console.error('FAIL', e);
  process.exit(1);
});
