// Abonos de 20 que siguen «En revisión» → PAGADO. Sin --aplicar solo muestra.
//
// Por qué: Sara los sacó de Contabilidad el 2026-10-03 cuando nadie sabía qué
// eran. Desde el 2026-11-03 (bitácora 176) el primer pago de un plan con abono
// se cuenta por el RESTANTE (130 de 150, 480 de 500), así que un abono que
// sigue «En revisión» es dinero cobrado que no suma en ningún sitio. La revisión
// diaria lo avisa cada mañana («Abono fuera de Contabilidad») y la única forma
// de que se calle es que el dato quede bien.
//
// Solo toca filas que (1) están EN_REVISION y (2) son de la oferta de abono
// 9veek0a9 según el propio aviso de Hotmart. Nada más. Deja cada cambio en
// AuditLog para poder deshacerlo.
//
//   railway run --service backend --environment production --project ba90d94d-7e6d-4056-85ad-0e3f24e8d43a \
//     node scripts/pasar-abonos-a-pagado.cjs [--aplicar]
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL } } });
const APLICAR = process.argv.includes('--aplicar');

(async () => {
  const filas = await p.$queryRawUnsafe(`
    SELECT DISTINCT ON (i.id) i.id, i."externalTxId" tx, i."grossUsd"::float8 usd, i."saleDate", i.category, i."tenantId", i."brandName",
           e.payload->'data'->'buyer'->>'name' comprador
      FROM "IncomeRecord" i
      JOIN "HotmartWebhookEvent" e ON e.payload->'data'->'purchase'->>'transaction' = i."externalTxId"
     WHERE i.status = 'EN_REVISION'
       AND lower(e.payload->'data'->'purchase'->'offer'->>'code') = '9veek0a9'
     ORDER BY i.id, e."processedAt"`);
  console.log(`${filas.length} abono(s) en revisión${APLICAR ? '' : ' (ensayo: nada se escribe)'}:`);
  for (const f of filas) {
    console.log(`  ${f.tx} $${f.usd} ${new Date(f.saleDate).toISOString().slice(0, 10)} categoría=${f.category} negocio=${f.brandName ?? '— (sin negocio)'} comprador=${f.comprador ?? '—'}`);
    if (!APLICAR) continue;
    const r = await p.incomeRecord.updateMany({ where: { id: f.id, status: 'EN_REVISION' }, data: { status: 'PAGADO' } });
    if (r.count) {
      await p.auditLog.create({
        data: { tenantId: f.tenantId, action: 'income.abono_a_pagado', resource: 'IncomeRecord', metadata: { id: f.id, tx: f.tx, antes: 'EN_REVISION', ahora: 'PAGADO', motivo: 'revisión diaria 2026-11-16: abono fuera de Contabilidad' } },
      });
    }
    console.log(r.count ? '    → PAGADO' : '    → ya no estaba en revisión, no se tocó');
  }
})()
  .catch((e) => { console.error('ERROR', e.message); process.exitCode = 1; })
  .finally(() => p.$disconnect());
