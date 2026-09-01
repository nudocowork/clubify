/**
 * AJUSTE (2026-08-31) — deja las comisiones de Quipao en $5.00 exactos.
 *
 * La versión vieja del intercambio dejó la del 15-jul en PARTIAL ($4.95 pagados
 * de $5.00, $0.05 pendiente) y la del 1-ago en $4.95. El dueño quiere $5.00
 * completos ("se pagó el total") y que Quipao siempre sea $5.00.
 *
 * Este script parte del estado ACTUAL:
 *   - 15-jul: amountPaid $4.95 → $5.00, paymentStatus PARTIAL → PAID.
 *   - 1-ago:  amount $4.95 → $5.00 (sigue Disponible/PENDING).
 * y recalcula los totales de los cortes afectados. Guard idempotente.
 *
 * Uso:  cd backend && railway run node scripts/fix-quipao-round-to-5.cjs
 */
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

const ID_15JUL = '323b668d-1dd5-4d4b-98fa-227e7a6d529e';
const ID_1AGO = 'd2360728-ebd9-429e-b715-edfde641f960';
const money = (x) => '$' + Number(x ?? 0).toFixed(2);

async function recalc(batchId) {
  if (!batchId) return;
  const agg = await p.commission.aggregate({
    where: { payoutBatchId: batchId, status: { not: 'REJECTED' } },
    _sum: { amount: true },
  });
  const total = Math.round(Number(agg._sum.amount ?? 0) * 100) / 100;
  await p.payoutBatch.update({ where: { id: batchId }, data: { totalUsd: total } });
  console.log(`  recalc corte ${batchId.slice(0, 8)}…: totalUsd = ${money(total)}`);
}

(async () => {
  const [c15, c1a] = await Promise.all([
    p.commission.findUnique({ where: { id: ID_15JUL } }),
    p.commission.findUnique({ where: { id: ID_1AGO } }),
  ]);
  if (!c15 || !c1a) { console.log('No encontré una de las comisiones.'); return p.$disconnect(); }

  console.log('ANTES:');
  console.log(`  15-jul: monto=${money(c15.amount)} pay=${c15.paymentStatus} pagado=${money(c15.amountPaid)}`);
  console.log(`  1-ago:  monto=${money(c1a.amount)} pay=${c1a.paymentStatus} pagado=${money(c1a.amountPaid)}`);

  const need15 = Number(c15.amountPaid) < 5 || c15.paymentStatus !== 'PAID';
  const need1a = Number(c1a.amount) < 5;
  if (!need15 && !need1a) {
    console.log('\nYa están ambas en $5.00 completos. No toco nada.');
    return p.$disconnect();
  }

  if (need15) {
    await p.commission.update({
      where: { id: ID_15JUL },
      data: { amount: 5.0, amountPaid: 5.0, paymentStatus: 'PAID', status: 'PAID' },
    });
  }
  if (need1a) {
    await p.commission.update({ where: { id: ID_1AGO }, data: { amount: 5.0 } });
  }

  console.log('\nRecalculando cortes:');
  await recalc(c15.payoutBatchId);
  if (c1a.payoutBatchId && c1a.payoutBatchId !== c15.payoutBatchId) await recalc(c1a.payoutBatchId);

  const [n15, n1a] = await Promise.all([
    p.commission.findUnique({ where: { id: ID_15JUL } }),
    p.commission.findUnique({ where: { id: ID_1AGO } }),
  ]);
  console.log('\nDESPUÉS:');
  console.log(`  15-jul: monto=${money(n15.amount)} pay=${n15.paymentStatus} pagado=${money(n15.amountPaid)}`);
  console.log(`  1-ago:  monto=${money(n1a.amount)} pay=${n1a.paymentStatus} pagado=${money(n1a.amountPaid)}`);
  console.log('\nListo. Quipao: 15-jul PAGADA $5.00 (sin $0.05) · 1-ago DISPONIBLE $5.00.');
  await p.$disconnect();
})().catch(async (e) => {
  console.error('ERROR:', e.message);
  await p.$disconnect();
  process.exit(1);
});
