// SOLO LECTURA. Ingresos de Contabilidad en un rango que NO están en el reporte
// de Hotmart (pagos manuales, otras pasarelas, o tx que el reporte no trae), con
// sus referidos y comisiones. Complemento de arqueo-corte.cjs.
//   railway run ... node scripts/diag-ingresos-fuera-de-reporte.cjs <reporte.tsv> 2026-10-16 2026-10-31
const fs = require('fs');
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL } } });
const [archivo, desde, hasta] = process.argv.slice(2);
const d = (x) => (x ? new Date(x).toISOString().slice(0, 10) : '—');
(async () => {
  const enReporte = new Set(fs.readFileSync(archivo, 'utf8').trim().split(/\r?\n/).slice(1).map((l) => l.split('\t')[0]));
  const ingresos = await p.incomeRecord.findMany({
    where: { saleDate: { gte: new Date(`${desde}T05:00:00Z`), lt: new Date(new Date(`${hasta}T05:00:00Z`).getTime() + 86400000) } },
    select: { externalTxId: true, gateway: true, brandName: true, grossUsd: true, saleDate: true, status: true, category: true, tenantId: true, whiteLabelId: true, payerWhiteLabelId: true },
    orderBy: { saleDate: 'asc' },
  });
  const fuera = ingresos.filter((i) => !enReporte.has(i.externalTxId));
  console.log(`${ingresos.length} ingresos ${desde}→${hasta}; fuera del reporte de Hotmart: ${fuera.length}`);
  for (const i of fuera) {
    const usos = i.tenantId ? await p.referralUse.findMany({ where: { tenantId: i.tenantId }, select: { status: true, referralCode: { select: { ownerName: true, code: true } } } }) : [];
    const coms = i.tenantId
      ? await p.commission.findMany({
          where: { referralUse: { tenantId: i.tenantId }, status: { not: 'REJECTED' }, businessDate: { gte: new Date(i.saleDate.getTime() - 5 * 86400000), lte: new Date(i.saleDate.getTime() + 5 * 86400000) } },
          select: { amount: true, status: true, payoutBatch: { select: { code: true } }, recipientCode: { select: { ownerName: true } } },
        })
      : [];
    console.log(`  ${d(i.saleDate)} ${i.gateway} ${i.externalTxId} ${i.brandName ?? '—'} $${Number(i.grossUsd)} ${i.status} ${i.category} marca=${i.whiteLabelId ?? 'null'} pagaMarca=${i.payerWhiteLabelId ?? '—'}`);
    console.log(`     referidos: ${usos.map((u) => `${u.referralCode?.ownerName} [${u.referralCode?.code}] ${u.status}`).join(' · ') || 'NINGUNO'}`);
    for (const c of coms) console.log(`     comisión $${Number(c.amount)} a ${c.recipientCode?.ownerName} ${c.status} corte ${c.payoutBatch?.code ?? 'NINGUNO'}`);
  }
})().catch((e) => { console.error('ERROR', e.message); process.exitCode = 1; }).finally(() => p.$disconnect());
