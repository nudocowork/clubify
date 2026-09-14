// Añade `customerBusinessName` y `customerTaxInfo` a Order.
//
// Los pide Humberto para Sellea: hay negocios que facturan a empresas y
// necesitan saber a nombre de quién y con qué datos fiscales. Los dos son
// OPCIONALES y solo se enseñan en las marcas que los activan.
//
// Aditivo e idempotente (`IF NOT EXISTS`), nunca `prisma db push`: producción
// tiene índices únicos parciales que un push borra.
//
// Uso: railway run --service Postgres-Nq8w node scripts/apply-order-billing-fields-migration.cjs [--aplicar]
const { PrismaClient } = require('@prisma/client');

const APLICAR = process.argv.includes('--aplicar');

const DDL = [
  `ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "customerBusinessName" TEXT`,
  `ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "customerTaxInfo" TEXT`,
];

(async () => {
  const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
  if (!url) { console.error('No DATABASE_URL'); process.exit(1); }
  const prisma = new PrismaClient({ datasources: { db: { url } } });

  const ya = await prisma.$queryRawUnsafe(`
    SELECT column_name FROM information_schema.columns
     WHERE table_name = 'Order'
       AND column_name IN ('customerBusinessName','customerTaxInfo')
  `);
  console.log('columnas que ya existen:', ya.map((c) => c.column_name).join(', ') || '(ninguna)');

  if (!APLICAR) {
    console.log('\n-- DRY RUN. Se ejecutaría:');
    for (const q of DDL) console.log('   ' + q + ';');
    await prisma.$disconnect();
    return;
  }

  for (const q of DDL) {
    await prisma.$executeRawUnsafe(q);
    console.log('ok  ' + q);
  }
  const n = await prisma.order.count();
  console.log(`\nlisto · ${n} pedidos en la tabla, ninguno modificado (columnas nuevas en NULL)`);
  await prisma.$disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
