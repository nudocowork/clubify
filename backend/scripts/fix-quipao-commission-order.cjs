/**
 * CORRECCIÓN puntual (2026-08-31) — orden de pago de comisiones de Quipao
 * Bubble Tea (afiliado Nicolás, código TAFMPWK5).
 *
 * PROBLEMA (verificado en prod): la comisión del 15-jul quedó con
 * `availableAt = 2026-08-30` cuando debía ser `2026-07-30` (businessDate 15-jul
 * + 15 días de hold). Por eso el corte del 24-ago la saltó y pagó la del 1-ago,
 * invirtiendo el orden.
 *
 * DECISIÓN DEL DUEÑO (intercambio completo, montos $5.00): la del 15-jul aparece
 * PAGADA por $5.00 (el pago del 24-ago se re-atribuye a ella; se redondea a
 * $5.00 — "se pagó el total"), y la del 1-ago vuelve a Disponible por $5.00
 * (todas las comisiones de Quipao son $5.00, no $4.95).
 *
 * Uso:  cd backend && railway run node scripts/fix-quipao-commission-order.cjs
 */
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

const ID_15JUL = '323b668d-1dd5-4d4b-98fa-227e7a6d529e';
const ID_1AGO = 'd2360728-ebd9-429e-b715-edfde641f960';
const CORTE_PAGADO = 'CORTE-2026-08-15'; // donde se transfirió el pago
const CORTE_ABIERTO = 'CORTE-2026-08-31'; // abierto: recibe la 1-ago pendiente
const AVAILABLE_15JUL = new Date('2026-07-30T00:00:00.000Z'); // 15-jul + 15d
const AVAILABLE_1AGO = new Date('2026-08-16T00:00:00.000Z'); // 1-ago + 15d
const PAID_AT = new Date('2026-08-24T00:00:00.000Z'); // fecha real del pago

const d = (x) => (x ? new Date(x).toISOString().slice(0, 10) : '—');
const money = (x) => '$' + Number(x ?? 0).toFixed(2);

async function recalc(batchId, label) {
  const agg = await p.commission.aggregate({
    where: { payoutBatchId: batchId, status: { not: 'REJECTED' } },
    _sum: { amount: true },
  });
  const total = Math.round(Number(agg._sum.amount ?? 0) * 100) / 100;
  await p.payoutBatch.update({ where: { id: batchId }, data: { totalUsd: total } });
  console.log(`  recalc ${label}: totalUsd = ${money(total)}`);
  return total;
}

(async () => {
  const [c15, c1a] = await Promise.all([
    p.commission.findUnique({ where: { id: ID_15JUL } }),
    p.commission.findUnique({ where: { id: ID_1AGO } }),
  ]);
  if (!c15 || !c1a) {
    console.log('No encontré una de las comisiones. Aborto.');
    return p.$disconnect();
  }

  console.log('ANTES:');
  console.log(
    `  15-jul: monto=${money(c15.amount)} available=${d(c15.availableAt)} status=${c15.status} pay=${c15.paymentStatus} pagado=${money(c15.amountPaid)} paidAt=${d(c15.paidAt)}`,
  );
  console.log(
    `  1-ago:  monto=${money(c1a.amount)} available=${d(c1a.availableAt)} status=${c1a.status} pay=${c1a.paymentStatus} pagado=${money(c1a.amountPaid)} paidAt=${d(c1a.paidAt)}`,
  );

  // Guard anti-doble-corrida: solo procede si el estado es el original.
  if (c15.paymentStatus !== 'PENDING' || c1a.paymentStatus !== 'PAID') {
    console.log('\n⚠ El estado ya no es el original (¿ya se corrigió?). No toco nada.');
    return p.$disconnect();
  }

  const bPagado = await p.payoutBatch.findUnique({ where: { code: CORTE_PAGADO } });
  const bAbierto = await p.payoutBatch.findUnique({ where: { code: CORTE_ABIERTO } });
  if (!bPagado || !bAbierto) {
    console.log('No encontré uno de los cortes. Aborto.');
    return p.$disconnect();
  }

  // 15-jul → PAGADA por $5.00 completo (el $4.95 transferido se redondea a $5).
  await p.commission.update({
    where: { id: ID_15JUL },
    data: {
      amount: 5.0,
      availableAt: AVAILABLE_15JUL, // corrige el hold: 30-jul (era 30-ago)
      status: 'PAID',
      paymentStatus: 'PAID',
      amountPaid: 5.0,
      paidAt: PAID_AT,
      payoutBatchId: bPagado.id, // al corte donde se transfirió
      notes: [c15.notes, '[2026-08-31] Corrección de orden: pagada $5.00 (re-atribuido el pago del 24-ago, redondeado desde $4.95).'].filter(Boolean).join(' '),
    },
  });

  // 1-ago → Disponible (pendiente) por $5.00 en el corte abierto.
  await p.commission.update({
    where: { id: ID_1AGO },
    data: {
      amount: 5.0, // Quipao siempre $5.00, no $4.95
      availableAt: AVAILABLE_1AGO,
      status: 'APPROVED',
      paymentStatus: 'PENDING',
      amountPaid: 0,
      paidAt: null,
      payoutBatchId: bAbierto.id,
      notes: [c1a.notes, '[2026-08-31] Corrección de orden: el pago del 24-ago se re-atribuyó a la del 15-jul. Queda Disponible por $5.00.'].filter(Boolean).join(' '),
    },
  });

  console.log('\nRecalculando totales de los cortes afectados:');
  await recalc(bPagado.id, CORTE_PAGADO);
  await recalc(bAbierto.id, CORTE_ABIERTO);

  const [n15, n1a] = await Promise.all([
    p.commission.findUnique({ where: { id: ID_15JUL } }),
    p.commission.findUnique({ where: { id: ID_1AGO } }),
  ]);
  console.log('\nDESPUÉS:');
  console.log(
    `  15-jul: monto=${money(n15.amount)} available=${d(n15.availableAt)} status=${n15.status} pay=${n15.paymentStatus} pagado=${money(n15.amountPaid)} paidAt=${d(n15.paidAt)} corte=${CORTE_PAGADO}`,
  );
  console.log(
    `  1-ago:  monto=${money(n1a.amount)} available=${d(n1a.availableAt)} status=${n1a.status} pay=${n1a.paymentStatus} pagado=${money(n1a.amountPaid)} paidAt=${d(n1a.paidAt)} corte=${CORTE_ABIERTO}`,
  );
  console.log('\nListo. 15-jul: PAGADA $5.00 · 1-ago: DISPONIBLE $5.00. Sin saldos de $0.05.');
  await p.$disconnect();
})().catch(async (e) => {
  console.error('ERROR:', e.message);
  await p.$disconnect();
  process.exit(1);
});
