// READ-ONLY: plan real de monet (para calcular la base de comisión correcta) —
// del payload Hotmart + del registro Plan + estado de ciclo del tenant.
const { PrismaClient } = require('@prisma/client');
const SUB = '6mwn78pn';
(async () => {
  const p = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL } } });

  const t = await p.tenant.findFirst({
    where: { brandName: { contains: 'monet', mode: 'insensitive' } },
    select: { id: true, planPeriodicity: true, subscriptionPriceUsd: true, currentPeriodEnd: true, suspendedAt: true, status: true, planId: true },
  });
  console.log('monet tenant:', JSON.stringify(t, null, 2));

  if (t?.planId) {
    const plan = await p.plan.findUnique({ where: { id: t.planId } });
    console.log('\nPlan de monet:', JSON.stringify(plan, null, 2));
  }

  // Landing plans (precios canónicos por periodicidad).
  const keys = ['landing.plans.mensual.checkoutUrl','landing.plans.trimestral.checkoutUrl'];

  // Payload del webhook: precio, oferta, recurrencia.
  const recent = await p.hotmartWebhookEvent.findMany({ orderBy: { processedAt: 'desc' }, take: 60, select: { eventType: true, processedAt: true, payload: true } });
  const ev = recent.find((e) => JSON.stringify(e.payload).toLowerCase().includes(SUB));
  if (ev) {
    const d = ev.payload?.data || {};
    console.log('\n════ Payload de la compra de monet ════');
    console.log('  eventType:', ev.eventType, '·', ev.processedAt.toISOString());
    console.log('  purchase.price:', JSON.stringify(d.purchase?.price));
    console.log('  purchase.offer:', JSON.stringify(d.purchase?.offer));
    console.log('  purchase.recurrencyNumber:', d.purchase?.recurrencyNumber);
    console.log('  subscription.plan:', JSON.stringify(d.subscription?.plan));
    console.log('  subscription.subscriber:', JSON.stringify(d.subscription?.subscriber));
    console.log('  purchase.full_price / checkout:', JSON.stringify(d.purchase?.full_price), JSON.stringify(d.purchase?.checkout_country));
  } else {
    console.log('\n(no encontré el payload por SUB en los recientes)');
  }
  await p.$disconnect();
})().catch((e) => { console.error(e.message); process.exit(1); });
