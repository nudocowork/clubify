/* READ-ONLY. Lista los tenants que tienen una Commission no-rechazada pero
 * Tenant.lastChargeAt = NULL (cobro invisible al panel). Con detalle para
 * (a) diseñar el fix forward (Fase 2) y (b) el listado de filas del backfill
 * (Fase 3). Solo SELECT. NO escribe. NO toca comisiones. */
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const d = (x) => (x ? new Date(x).toISOString().slice(0, 10) : '—');

(async () => {
  const comms = await prisma.commission.findMany({
    where: { status: { not: 'REJECTED' } },
    select: {
      amount: true, businessDate: true, createdAt: true, status: true,
      referralUse: {
        select: {
          tenant: {
            select: {
              id: true, brandName: true, status: true, lastChargeAt: true,
              createdAt: true, currentPeriodEnd: true, planPeriodicity: true,
              subscriptionPriceUsd: true, hotmartSubscriberCode: true,
              hotmartTransactionId: true, whiteLabelId: true, trialStartedAt: true,
            },
          },
        },
      },
    },
  });

  // Agrupar por tenant afectado (lastChargeAt null).
  const byTenant = new Map();
  for (const c of comms) {
    const t = c.referralUse?.tenant;
    if (!t || t.lastChargeAt) continue;
    if (!byTenant.has(t.id)) byTenant.set(t.id, { t, comms: [] });
    byTenant.get(t.id).comms.push(c);
  }

  console.log(`\n=== Tenants con comisión pero lastChargeAt NULL: ${byTenant.size} ===\n`);
  for (const { t, comms } of byTenant.values()) {
    const firstBiz = comms.map((c) => c.businessDate || c.createdAt).sort()[0];
    const activatedVia = t.hotmartSubscriberCode
      ? 'HOTMART'
      : t.whiteLabelId
        ? 'posible CRÉDITO marca / manual'
        : 'manual/otro';
    console.log(`• ${t.brandName} [${t.status}] ${t.planPeriodicity ?? '—'}`);
    console.log(`   createdAt=${d(t.createdAt)} · currentPeriodEnd=${d(t.currentPeriodEnd)} · trialStartedAt=${d(t.trialStartedAt)}`);
    console.log(`   hotmartSub=${t.hotmartSubscriberCode ?? '—'} · hotmartTx=${t.hotmartTransactionId ?? '—'} · subPriceUsd=${t.subscriptionPriceUsd ?? '—'}`);
    console.log(`   activación probable: ${activatedVia}`);
    console.log(`   comisiones (${comms.length}): ${comms.map((c) => `$${Number(c.amount)}@${d(c.businessDate || c.createdAt)}[${c.status}]`).join(', ')}`);
    console.log(`   → lastChargeAt sugerido para backfill = businessDate más antigua = ${d(firstBiz)}\n`);
  }
  console.log('======== FIN (read-only, nada escrito) ========');
  await prisma.$disconnect();
})().catch(async (e) => { console.error('ERROR:', e.message); await prisma.$disconnect(); process.exit(1); });
