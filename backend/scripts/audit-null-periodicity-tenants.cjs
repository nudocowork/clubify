// READ-ONLY: audita tenants con planPeriodicity=null. Cruza con el webhook
// Hotmart (por hotmartSubscriberCode) para inferir el plan REAL y detectar
// periodicidad/ciclo mal + falta de afiliado.
const { PrismaClient } = require('@prisma/client');
const inferPeriod = (s) => {
  const x = (s || '').toLowerCase();
  if (x.includes('trimestr') || x.includes('150')) return 'TRIMESTRAL';
  if (x.includes('semestr') || x.includes('278') || x.includes('275')) return 'SEMESTRAL';
  if (x.includes('anual') || x.includes('500') || x.includes('499')) return 'ANUAL';
  if (x.includes('mensual') || x.includes('68') || x.includes('50 usd')) return 'MENSUAL';
  return '?';
};
(async () => {
  const p = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL } } });

  const nulls = await p.tenant.findMany({
    where: { planPeriodicity: null },
    select: {
      id: true, brandName: true, email: true, status: true, hotmartSubscriberCode: true,
      subscriptionPriceUsd: true, currentPeriodEnd: true, createdAt: true,
      plan: { select: { name: true, priceMonthly: true } },
      referralUses: { where: { referralCode: { role: { in: ['INFLUENCER','AMBASSADOR','VENDOR'] } } }, select: { id: true } },
    },
    orderBy: { createdAt: 'desc' },
  });

  // Índice de webhooks PURCHASE_APPROVED por subscriber code.
  const evs = await p.hotmartWebhookEvent.findMany({
    where: { eventType: { in: ['PURCHASE_APPROVED','PURCHASE_COMPLETE','SUBSCRIPTION_CANCELLATION'] } },
    select: { payload: true }, orderBy: { processedAt: 'desc' }, take: 800,
  });
  const bySub = new Map();
  for (const e of evs) {
    const sub = e.payload?.data?.subscription?.subscriber?.code || e.payload?.data?.purchase?.subscription?.subscriber?.code;
    const plan = e.payload?.data?.subscription?.plan?.name;
    const offer = e.payload?.data?.purchase?.offer?.description;
    if (sub && !bySub.has(sub)) bySub.set(sub, { plan, offer });
  }

  console.log(`\n════ ${nulls.length} tenants con planPeriodicity = null ════`);
  let active = 0, noAff = 0, nonMensual = 0;
  for (const t of nulls) {
    const wh = t.hotmartSubscriberCode ? bySub.get(t.hotmartSubscriberCode) : null;
    const real = inferPeriod(wh?.plan || wh?.offer);
    if (t.status === 'ACTIVE') active++;
    const hasAff = t.referralUses.length > 0;
    if (!hasAff) noAff++;
    if (real !== 'MENSUAL' && real !== '?') nonMensual++;
    console.log(
      `  ${(t.brandName||'—').slice(0,22).padEnd(22)} ${String(t.status).padEnd(9)} plan=${(t.plan?.name||'—').padEnd(8)} realPeriod=${real.padEnd(11)} vence=${t.currentPeriodEnd ? new Date(t.currentPeriodEnd).toISOString().slice(0,10) : '—'} afiliado=${hasAff?'sí':'NO'} ${wh?`· hotmart="${(wh.plan||wh.offer||'').slice(0,24)}"`:'· (sin webhook)'}`);
  }
  console.log(`\nResumen: ${nulls.length} con periodicidad null · ${active} ACTIVE · ${noAff} sin afiliado · ${nonMensual} con plan NO-mensual (ciclo/base mal)`);
  await p.$disconnect();
})().catch((e) => { console.error(e.message); process.exit(1); });
