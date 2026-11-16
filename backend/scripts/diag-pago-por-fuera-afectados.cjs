// SOLO LECTURA. Negocios con pago por fuera (manualPayment) afectados por lo de
// Motilart: afiliados en CHURNED estando activos, fecha de cobro corrida más de
// un período después del último pago, y comisiones que llevan la transacción de
// Hotmart del último cobro viejo.
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL } } });
const d = (x) => (x ? new Date(x).toISOString().slice(0, 10) : '—');
const meses = (per) => (/SEMESTRAL/i.test(per || '') ? 6 : /TRIMESTRAL/i.test(per || '') ? 3 : /ANUAL/i.test(per || '') ? 12 : 1);
function sumar(desde, per) { const x = new Date(desde); const dia = x.getUTCDate(); x.setUTCDate(1); x.setUTCMonth(x.getUTCMonth() + meses(per)); x.setUTCDate(Math.min(dia, new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth() + 1, 0)).getUTCDate())); return x; }
(async () => {
  const ts = await p.tenant.findMany({
    where: { manualPayment: true, deletedAt: null },
    select: { id: true, brandName: true, status: true, lastChargeAt: true, currentPeriodEnd: true, planPeriodicity: true, hotmartTransactionId: true, notes: true },
  });
  console.log(`Negocios con pago por fuera: ${ts.length}`);
  for (const t of ts) {
    const usos = await p.referralUse.findMany({ where: { tenantId: t.id }, select: { status: true, referralCode: { select: { ownerName: true, role: true } } } });
    const churned = usos.filter((u) => u.status === 'CHURNED');
    const corrida = t.lastChargeAt && t.currentPeriodEnd && t.currentPeriodEnd.getTime() > sumar(t.lastChargeAt, t.planPeriodicity).getTime() + 2 * 864e5;
    const conTxVieja = t.hotmartTransactionId
      ? await p.commission.count({ where: { referralUse: { tenantId: t.id }, externalTxId: t.hotmartTransactionId, createdAt: { gt: t.lastChargeAt ?? new Date(0) } } })
      : 0;
    const marcas = [];
    if (t.status === 'ACTIVE' && churned.length) marcas.push(`AFILIADOS CHURNED ${churned.length}/${usos.length}`);
    if (corrida) marcas.push('FECHA CORRIDA');
    if (conTxVieja) marcas.push(`COMISIONES CON TX VIEJA ${conTxVieja}`);
    console.log(`${marcas.length ? '⚠' : ' '} ${t.brandName} ${t.status} últimoPago ${d(t.lastChargeAt)} próximo ${d(t.currentPeriodEnd)} ${t.planPeriodicity} afiliados ${usos.map((u) => `${u.referralCode.ownerName}(${u.status})`).join(', ') || 'ninguno'} ${marcas.join(' · ')}`);
  }
})().catch((e) => { console.error('ERROR', e.message); process.exitCode = 1; }).finally(() => p.$disconnect());
