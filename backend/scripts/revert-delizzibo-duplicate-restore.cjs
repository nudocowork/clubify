/**
 * (2026-09-01) — REVIERTE un error mío: restauré una comisión DUPLICADA de
 * Delizzibo. El pago del 31-jul se registró DOBLE en Hotmart → dos comisiones de
 * $6.80 para Nicolás Quintero:
 *   - 850ddd7f: la REAL (tx HP0670732820), PAGADA el 24-ago. → se queda.
 *   - 338f7839: el DUPLICADO (sin tx), que estaba REJECTED bien. Yo lo restauré a
 *     APPROVED y lo atajé al corte por error → hay que devolverlo a REJECTED,
 *     sacarlo del corte y recalcular.
 *
 * Guard: solo actúa si existe la hermana PAGADA del mismo businessDate (confirma
 * que es duplicado). Idempotente.
 *
 * Uso:  cd backend && railway run node scripts/revert-delizzibo-duplicate-restore.cjs
 */
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
const DUP = '338f7839-cab3-4951-84f9-fff609d3138a'; // el duplicado que restauré por error

async function recalcBatchTotal(batchId) {
  const agg = await p.commission.aggregate({
    where: { payoutBatchId: batchId, status: { not: 'REJECTED' } },
    _sum: { amount: true },
  });
  const total = Math.round(Number(agg._sum.amount ?? 0) * 100) / 100;
  await p.payoutBatch.update({ where: { id: batchId }, data: { totalUsd: total } });
  return total;
}

(async () => {
  const dup = await p.commission.findUnique({
    where: { id: DUP },
    select: {
      status: true, amount: true, businessDate: true, payoutBatchId: true, referralUseId: true, recipientCodeId: true,
      referralUse: { select: { tenantId: true } },
    },
  });
  if (!dup) { console.log('No encontré la comisión.'); return p.$disconnect(); }

  // Confirmar que es duplicado: hermana PAGADA del MISMO DÍA de cobro (no por
  // timestamp exacto — el duplicado se registró a otra hora del 31-jul).
  const dupDay = dup.businessDate ? dup.businessDate.toISOString().slice(0, 10) : null;
  const paidSibling = await p.commission.findFirst({
    where: {
      id: { not: DUP },
      status: 'PAID',
      recipientCodeId: dup.recipientCodeId,
      referralUse: { tenantId: dup.referralUse?.tenantId },
      ...(dupDay
        ? {
            businessDate: {
              gte: new Date(dupDay + 'T00:00:00.000Z'),
              lt: new Date(dupDay + 'T23:59:59.999Z'),
            },
          }
        : {}),
    },
    select: { id: true, paidAt: true, hotmartTransactionId: true, externalTxId: true },
  });
  if (!paidSibling) {
    console.log('⚠️ No encontré una hermana PAGADA del mismo día de cobro. NO es claramente duplicado → NO toco nada.');
    return p.$disconnect();
  }
  console.log(`Duplicado confirmado: la hermana ${paidSibling.id.slice(0,8)} (tx ${paidSibling.hotmartTransactionId||paidSibling.externalTxId}) ya está PAGADA (${paidSibling.paidAt?.toISOString().slice(0,10)}).`);

  const batchId = dup.payoutBatchId;
  await p.commission.update({
    where: { id: DUP },
    data: {
      status: 'REJECTED',
      payoutBatchId: null,
      notes: `Duplicado del pago del 31-jul (hermana ${paidSibling.id} ya pagada, tx ${paidSibling.hotmartTransactionId||paidSibling.externalTxId}). Restaurado por error el 2026-09-01 y revertido.`,
    },
  });
  console.log(`✓ Duplicado ${DUP.slice(0,8)} → REJECTED y sacado del corte.`);

  if (batchId) {
    const total = await recalcBatchTotal(batchId);
    console.log(`✓ Total del corte recalculado: $${total}`);
  }
  await p.$disconnect();
})().catch(async (e) => { console.error('ERROR:', e.message); await p.$disconnect(); process.exit(1); });
