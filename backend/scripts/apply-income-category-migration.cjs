// Añade `category`, `status` y `refundedAt` a IncomeRecord, y rellena las filas
// que ya existen.
//
// Aditivo e idempotente (`IF NOT EXISTS`), nunca `prisma db push`: producción
// tiene índices únicos parciales que Prisma no sabe expresar y un push los
// borra. Modelo copiado de `apply-email-config-migration.cjs`.
//
// El relleno NO inventa nada: la categoría sale de lo que ya está guardado —
// un ingreso sin negocio y con `productName` es un pack de créditos (OTRO), un
// `isFirstPayment` es una venta NUEVA, el resto es RENOVACION. UPGRADE no se
// puede deducir del histórico y se deja para los cobros que vengan.
//
// Uso: railway run --service Postgres-Nq8w node scripts/apply-income-category-migration.cjs [--aplicar]
const { PrismaClient } = require('@prisma/client');

const APLICAR = process.argv.includes('--aplicar');

const DDL = [
  `ALTER TABLE "IncomeRecord" ADD COLUMN IF NOT EXISTS "category" TEXT`,
  `ALTER TABLE "IncomeRecord" ADD COLUMN IF NOT EXISTS "status" TEXT NOT NULL DEFAULT 'PAGADO'`,
  `ALTER TABLE "IncomeRecord" ADD COLUMN IF NOT EXISTS "refundedAt" TIMESTAMP(3)`,
  `CREATE INDEX IF NOT EXISTS "IncomeRecord_status_idx" ON "IncomeRecord"("status")`,
  `CREATE INDEX IF NOT EXISTS "IncomeRecord_category_idx" ON "IncomeRecord"("category")`,
];

// La categoría de una fila ya guardada, con lo que hay en la propia fila.
const RELLENO = `
  UPDATE "IncomeRecord" SET "category" = CASE
    WHEN "tenantId" IS NULL AND "productName" IS NOT NULL THEN 'OTRO'
    WHEN "isFirstPayment" THEN 'NUEVA'
    ELSE 'RENOVACION'
  END
  WHERE "category" IS NULL
`;

(async () => {
  const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
  if (!url) { console.error('No DATABASE_URL'); process.exit(1); }
  const prisma = new PrismaClient({ datasources: { db: { url } } });

  const antes = await prisma.$queryRawUnsafe(`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'IncomeRecord'
      AND column_name IN ('category','status','refundedAt')
  `);
  console.log('columnas que ya existen:', antes.map((c) => c.column_name).join(', ') || '(ninguna)');

  if (!APLICAR) {
    console.log('\n-- DRY RUN. Se ejecutaría:');
    for (const q of DDL) console.log('   ' + q + ';');
    console.log('   ' + RELLENO.trim().replace(/\s+/g, ' ') + ';');
    const previa = await prisma.$queryRawUnsafe(`
      SELECT CASE
               WHEN "tenantId" IS NULL AND "productName" IS NOT NULL THEN 'OTRO'
               WHEN "isFirstPayment" THEN 'NUEVA'
               ELSE 'RENOVACION'
             END AS categoria, COUNT(*)::int AS n, SUM("grossUsd")::float AS bruto
      FROM "IncomeRecord" GROUP BY 1 ORDER BY 2 DESC
    `);
    console.log('\n-- Cómo quedarían las filas actuales:');
    for (const r of previa) console.log(`   ${r.categoria.padEnd(12)} ${String(r.n).padStart(4)} filas  $${r.bruto.toFixed(2)}`);
    await prisma.$disconnect();
    return;
  }

  for (const q of DDL) {
    await prisma.$executeRawUnsafe(q);
    console.log('ok  ' + q);
  }
  const n = await prisma.$executeRawUnsafe(RELLENO);
  console.log(`\ncategoría rellenada en ${n} filas`);

  const resumen = await prisma.$queryRawUnsafe(`
    SELECT "category", "status", COUNT(*)::int AS n, SUM("grossUsd")::float AS bruto
    FROM "IncomeRecord" GROUP BY 1,2 ORDER BY 3 DESC
  `);
  for (const r of resumen) {
    console.log(`  ${String(r.category).padEnd(12)} ${String(r.status).padEnd(12)} ${String(r.n).padStart(4)} filas  $${r.bruto.toFixed(2)}`);
  }
  await prisma.$disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
