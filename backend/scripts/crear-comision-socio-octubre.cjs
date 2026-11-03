#!/usr/bin/env node
/**
 * Crea YA la comisión del socio de octubre (SOCIO-2026-10) en CORTE-2026-10-31,
 * sin esperar al cron de la hora (minuto 20). Mismo cálculo que
 * `comision-del-socio.service.ts`: 10 % del neto cobrado de Clubify en el mes.
 * Si ya existe, no hace nada; el cron la mantiene al día después.
 */
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const APLICAR = process.argv.includes('--aplicar');
const CLUBIFY = 'dfd3cdff-7836-4aee-96a4-d7fa2b2907be';
const r2 = (n) => Math.round(n * 100) / 100;

async function porcentaje() {
  for (const key of ['contabilidad.socio.porcentaje', 'referrals.socioPercent']) {
    const v = (await prisma.setting.findUnique({ where: { key } }))?.value;
    if (v != null && String(v).trim() !== '') {
      const n = Number(String(v).replace(',', '.'));
      return Number.isFinite(n) && n >= 0 && n <= 100 ? n : 10;
    }
  }
  return 10;
}

(async () => {
  const codeId = (await prisma.setting.findUnique({ where: { key: 'comisiones.socio.codeId' } }))?.value;
  const code = codeId ? await prisma.referralCode.findUnique({ where: { id: codeId } }) : null;
  if (!code || code.role !== 'SOCIO') throw new Error('Falta activar el socio (activar-comision-del-socio.cjs)');
  const ya = await prisma.commission.findFirst({ where: { recipientCodeId: code.id, periodKey: 'SOCIO-2026-10' } });
  if (ya) {
    console.log('= ya existe: ' + ya.amount + ' (' + ya.status + ')');
    return;
  }
  const pct = await porcentaje();
  const filas = await prisma.incomeRecord.findMany({
    where: {
      status: 'PAGADO',
      OR: [{ whiteLabelId: CLUBIFY }, { whiteLabelId: null }],
      saleDate: { gte: new Date('2026-10-01T05:00:00Z'), lt: new Date('2026-11-01T05:00:00Z') },
    },
    select: { netExpectedUsd: true },
  });
  const base = r2(filas.reduce((a, f) => a + Number(f.netExpectedUsd), 0));
  const monto = r2((base * pct) / 100);
  const lote = await prisma.payoutBatch.findUnique({ where: { code: 'CORTE-2026-10-31' } });
  if (!lote || lote.status !== 'OPEN') throw new Error('CORTE-2026-10-31 no está abierto');
  console.log((APLICAR ? 'APLICANDO' : 'ENSAYO') + ' → SOCIO-2026-10: ' + pct + '% de ' + base + ' = ' + monto + ' en CORTE-2026-10-31');
  if (!APLICAR) return;
  await prisma.commission.create({
    data: {
      recipientCodeId: code.id,
      referralUseId: null,
      amount: monto,
      currency: 'USD',
      status: 'APPROVED',
      paymentStatus: 'PENDING',
      amountPaid: 0,
      periodKey: 'SOCIO-2026-10',
      businessDate: new Date('2026-10-31T17:00:00Z'),
      availableAt: new Date('2026-10-31T17:00:00Z'),
      baseAmountUsd: base,
      appliedPercent: pct,
      payoutBatchId: lote.id,
      notes: 'Comisión del socio: ' + pct + '% de la facturación de 2026-10 ($' + base.toFixed(2) + ' de base, la misma de la línea «Socio» de Contabilidad).',
    },
  });
  const agg = await prisma.commission.aggregate({
    where: { payoutBatchId: lote.id, status: { not: 'REJECTED' } },
    _sum: { amount: true },
  });
  const total = r2(Number(agg._sum.amount ?? 0));
  await prisma.payoutBatch.update({ where: { id: lote.id }, data: { totalUsd: total } });
  console.log('✓ creada. Total del corte: ' + total);
})()
  .catch((e) => { console.error('ERROR', e.message); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
