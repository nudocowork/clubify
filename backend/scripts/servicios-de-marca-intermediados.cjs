/**
 * Los pagos de marcas blancas registrados como «Servicio: …» (la automatización
 * de WhatsApp de Sellea, 3 × $99,03 de Humberto) NO son ingreso de Clubify:
 * Clubify solo hace de intermediario (Sara, 2026-10-06). Se pasan de PAGADO a
 * INTERMEDIADO: el registro se queda, pero deja de sumar en Contabilidad, en la
 * base del socio y en la del 2 %. Desde este despliegue, registrar un servicio
 * ya lo guarda así.
 *
 * Además lista lo pagado por cada marca (para fijar la venta de Fideliso).
 *
 *   railway run --service Postgres-Nq8w node scripts/servicios-de-marca-intermediados.cjs [--aplicar]
 */
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient({
  datasources: { db: { url: process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL } },
});
const APLICAR = process.argv.includes('--aplicar');

(async () => {
  const filas = await p.$queryRawUnsafe(`
    SELECT i.id, i."externalTxId", i."productName", i."grossUsd"::float AS usd,
           i."saleDate"::date AS dia, w.name AS marca
      FROM "IncomeRecord" i JOIN "WhiteLabel" w ON w.id = i."payerWhiteLabelId"
     WHERE i."payerWhiteLabelId" IS NOT NULL
       AND i.status = 'PAGADO'
       AND lower(coalesce(i."productName", '')) LIKE 'servicio%'
     ORDER BY i."saleDate"`);
  if (!filas.length) console.log('Ningún servicio de marca contando como ingreso.');
  for (const f of filas) {
    console.log(`${APLICAR ? 'APLICO' : 'simulo'} ${f.marca} · ${f.dia.toISOString().slice(0, 10)} · ${f.productName} · $${f.usd} (${f.externalTxId}): PAGADO → INTERMEDIADO`);
    if (APLICAR) {
      await p.$executeRawUnsafe(
        `UPDATE "IncomeRecord" SET status = 'INTERMEDIADO', "updatedAt" = now() WHERE id = $1 AND status = 'PAGADO'`,
        f.id,
      );
    }
  }
  const total = filas.reduce((a, f) => a + f.usd, 0);
  if (filas.length) console.log(`Total que deja de contar como ingreso: $${total.toFixed(2)}`);

  console.log('\nLo pagado por cada marca (solo PAGADO):');
  const porMarca = await p.$queryRawUnsafe(`
    SELECT w.name AS marca, coalesce(i."productName", '—') AS concepto,
           count(*)::int AS pagos, sum(i."grossUsd")::float AS usd,
           min(i."saleDate")::date AS desde, max(i."saleDate")::date AS hasta
      FROM "IncomeRecord" i JOIN "WhiteLabel" w ON w.id = i."payerWhiteLabelId"
     WHERE i.status = 'PAGADO'
     GROUP BY 1, 2 ORDER BY 1, 2`);
  for (const r of porMarca) {
    console.log(`  ${r.marca} · ${r.concepto}: ${r.pagos} pago(s), $${r.usd.toFixed(2)} (${r.desde.toISOString().slice(0, 10)} → ${r.hasta.toISOString().slice(0, 10)})`);
  }
  if (!APLICAR) console.log('\n(simulación: --aplicar para escribir)');
  await p.$disconnect();
})().catch(async (e) => {
  console.error('ERROR:', e.message);
  await p.$disconnect();
  process.exit(1);
});
