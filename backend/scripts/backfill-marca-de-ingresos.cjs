// Rellena `IncomeRecord.whiteLabelId` en las filas que lo tienen en null pero
// sí tienen negocio.
//
// POR QUÉ: el dashboard de cobros filtra los ingresos por marca. Las filas sin
// marca no salían en NINGUNA vista, así que «Pagos procesados» marcaba $0 con
// el dinero ya cobrado y en la base (Jhon, 2026-09-11). El origen —un `select`
// de Hotmart que no pedía el campo— se arregla aparte; esto recupera lo ya
// escrito.
//
// Las filas SIN negocio (packs de créditos: `tenantId` null) se quedan como
// están: ahí la marca no se puede deducir y null es la respuesta correcta.
//
// Usage: railway run --service Postgres-Nq8w node scripts/backfill-marca-de-ingresos.cjs [--aplicar]
const { PrismaClient } = require('@prisma/client');

const APLICAR = process.argv.includes('--aplicar');

(async () => {
  const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
  if (!url) { console.error('No DATABASE_URL'); process.exit(1); }
  const prisma = new PrismaClient({ datasources: { db: { url } } });

  const huerfanos = await prisma.$queryRawUnsafe(`
    SELECT i.id, i."saleDate", i."brandName", i."grossUsd", i.gateway,
           t."whiteLabelId" AS wl, w.slug
      FROM "IncomeRecord" i
      JOIN "Tenant" t ON t.id = i."tenantId"
      LEFT JOIN "WhiteLabel" w ON w.id = t."whiteLabelId"
     WHERE i."whiteLabelId" IS NULL AND t."whiteLabelId" IS NOT NULL
     ORDER BY i."saleDate" DESC`);

  console.log(`Ingresos sin marca pero con negocio: ${huerfanos.length}`);
  for (const r of huerfanos) {
    console.log(
      `  ${r.saleDate.toISOString().slice(0, 10)} | ${String(r.brandName).slice(0, 24).padEnd(24)} | $${Number(r.grossUsd)} | ${r.gateway} → ${r.slug}`,
    );
  }

  const sinNegocio = await prisma.$queryRawUnsafe(
    `SELECT count(*) c FROM "IncomeRecord" WHERE "whiteLabelId" IS NULL AND "tenantId" IS NULL`,
  );
  console.log(`\nSin negocio (se quedan sin marca, es lo correcto): ${Number(sinNegocio[0].c)}`);

  if (!APLICAR) {
    console.log('\n(dry run: no se tocó nada. Añade --aplicar)');
    await prisma.$disconnect();
    return;
  }

  const n = await prisma.$executeRawUnsafe(`
    UPDATE "IncomeRecord" i
       SET "whiteLabelId" = t."whiteLabelId"
      FROM "Tenant" t
     WHERE t.id = i."tenantId"
       AND i."whiteLabelId" IS NULL
       AND t."whiteLabelId" IS NOT NULL`);
  console.log(`\n✓ ${n} ingresos atribuidos a su marca`);

  const resumen = await prisma.$queryRawUnsafe(`
    SELECT COALESCE(w.slug, '(sin marca)') marca, count(*) n, sum(i."grossUsd") usd
      FROM "IncomeRecord" i LEFT JOIN "WhiteLabel" w ON w.id = i."whiteLabelId"
     GROUP BY 1 ORDER BY 2 DESC`);
  console.log('\nIngresos por marca:');
  for (const r of resumen) console.log(`  ${r.marca.padEnd(12)} ${String(Number(r.n)).padStart(4)} registros  $${Number(r.usd)}`);

  await prisma.$disconnect();
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
