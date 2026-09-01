/**
 * (2026-09-01) — Mete las comisiones RESTAURADAS de Nicolás Quintero (Wok
 * Explosivo $5 + Delizzibo $6.80) al CORTE ACTUAL abierto, para que se le paguen.
 *
 * CONTEXTO: ambas se anularon por el bug del cron de suspendidos y se restauraron
 * a APPROVED, pero quedaron SIN corte (payoutBatchId=null) porque el corte ya se
 * había generado cuando estaban REJECTED. Sus availableAt (18-ago y 15-ago) son
 * anteriores al corte abierto CORTE-2026-08-31, así que le corresponden
 * (dayWindowWhere = availableAt < fecha del corte, acumulativo).
 *
 * QUÉ HACE (idempotente): atacha ambas al corte OPEN más viejo y recalcula su
 * total (= SUMA de amount de sus comisiones status != REJECTED, igual que
 * recalcBatchTotal). Guards: solo comisiones APPROVED + pagable + sin corte.
 *
 * Uso:  cd backend && railway run node scripts/attach-nicolas-restored-to-current-cutoff.cjs
 */
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
const IDS = [
  '1e75d89d-9cb8-4338-97b1-7bf28b955a07', // Wok Explosivo $5
  '338f7839-cab3-4951-84f9-fff609d3138a', // Delizzibo $6.80
];

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
  const batch = await p.payoutBatch.findFirst({
    where: { status: 'OPEN' },
    orderBy: { cutoffDate: 'asc' },
    select: { id: true, code: true, totalUsd: true },
  });
  if (!batch) { console.log('No hay corte ABIERTO. No hago nada.'); return p.$disconnect(); }
  console.log(`Corte actual abierto: ${batch.code} (total actual $${batch.totalUsd})`);

  let attached = 0;
  for (const id of IDS) {
    const c = await p.commission.findUnique({
      where: { id },
      select: {
        status: true, paymentStatus: true, recipientCodeId: true, payoutBatchId: true, amount: true,
        recipientCode: { select: { ownerName: true } },
        referralUse: { select: { tenant: { select: { brandName: true } } } },
      },
    });
    if (!c) { console.log(`  ${id}: no existe.`); continue; }
    const label = `${c.referralUse?.tenant?.brandName} $${c.amount} (${c.recipientCode?.ownerName?.trim()})`;
    if (c.payoutBatchId) { console.log(`  ${label}: ya está en un corte (${c.payoutBatchId}). Skip.`); continue; }
    const payable = c.status === 'APPROVED' && ['PENDING', 'PARTIAL'].includes(c.paymentStatus) && c.recipientCodeId;
    if (!payable) { console.log(`  ${label}: no es pagable (status=${c.status}, pay=${c.paymentStatus}). Skip.`); continue; }
    await p.commission.update({ where: { id }, data: { payoutBatchId: batch.id } });
    console.log(`  ${label}: atachada a ${batch.code} ✓`);
    attached++;
  }

  const newTotal = await recalcBatchTotal(batch.id);
  console.log(`\n${attached} atachada(s). Total recalculado de ${batch.code}: $${newTotal}`);
  await p.$disconnect();
})().catch(async (e) => { console.error('ERROR:', e.message); await p.$disconnect(); process.exit(1); });
