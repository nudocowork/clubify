// READ-ONLY: diagnóstico per-tenant de los ACTIVOS con planPeriodicity=null.
// Busca el webhook por hotmartSubscriberCode (raw SQL, sin límite de ventana)
// para inferir plan/periodicidad real + tracking(src) + estado de afiliado, y
// recomendar qué debería tener cada uno. NO escribe nada.
const { PrismaClient } = require('@prisma/client');
const NAMES = ['Vizage', 'La Gloriosa', 'Jamarea', 'Hacienda Don Antonio', 'Zekkei'];
const inferPeriod = (s) => {
  const x = (s || '').toLowerCase();
  if (x.includes('trimestr') || x.includes('150')) return 'TRIMESTRAL ($150)';
  if (x.includes('semestr') || x.includes('278') || x.includes('275')) return 'SEMESTRAL (~$278)';
  if (x.includes('anual') || x.includes('500') || x.includes('499')) return 'ANUAL (~$500)';
  if (x.includes('mensual') || x.includes('68')) return 'MENSUAL (~$68)';
  return '?';
};
(async () => {
  const p = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL } } });
  for (const name of NAMES) {
    const t = await p.tenant.findFirst({
      where: { brandName: { contains: name, mode: 'insensitive' } },
      select: {
        id: true, brandName: true, email: true, status: true, planPeriodicity: true,
        subscriptionPriceUsd: true, currentPeriodEnd: true, purchasedAt: true, hotmartSubscriberCode: true,
        plan: { select: { name: true, priceMonthly: true } },
        referralUses: { where: { referralCode: { role: { in: ['INFLUENCER','AMBASSADOR','VENDOR'] } } }, select: { referralCode: { select: { code: true, ownerName: true } } } },
      },
    });
    if (!t) { console.log(`\n### ${name}: no encontrado`); continue; }
    let wh = null;
    if (t.hotmartSubscriberCode) {
      const rows = await p.$queryRawUnsafe(
        `SELECT payload, "eventType", "processedAt" FROM "HotmartWebhookEvent" WHERE payload::text ILIKE $1 ORDER BY "processedAt" DESC LIMIT 5`,
        `%${t.hotmartSubscriberCode}%`);
      wh = rows.find((r) => r.eventType && r.eventType.startsWith('PURCHASE')) || rows[0] || null;
    }
    const planName = wh?.payload?.data?.subscription?.plan?.name;
    const offer = wh?.payload?.data?.purchase?.offer?.description;
    const price = wh?.payload?.data?.purchase?.price;
    const tracking = wh?.payload?.data?.purchase?.tracking || {};
    const real = inferPeriod(planName || offer);
    const aff = t.referralUses[0]?.referralCode;

    console.log(`\n### ${t.brandName} · ${t.status} · sub=${t.hotmartSubscriberCode ?? '—'}`);
    console.log(`   plan interno=${t.plan?.name ?? '—'} · periodicidad actual=${t.planPeriodicity ?? 'null'} · precio=${t.subscriptionPriceUsd ?? 'null'} · vence=${t.currentPeriodEnd ? new Date(t.currentPeriodEnd).toISOString().slice(0,10) : '—'}`);
    console.log(`   afiliado=${aff ? aff.code + ' (' + aff.ownerName + ')' : 'NINGUNO'}`);
    if (wh) {
      console.log(`   Hotmart: plan="${planName ?? '—'}" offer="${offer ?? '—'}" precio=${price ? price.value + ' ' + price.currency_value : '—'}`);
      console.log(`   tracking(src)=${JSON.stringify(tracking)}  → ${Object.keys(tracking).length ? 'HAY señal de afiliado recuperable' : 'VACÍO (atribución solo manual)'}`);
      console.log(`   → periodicidad REAL sugerida: ${real}`);
    } else {
      console.log(`   Hotmart: (sin webhook encontrado por subscriber code) → puede ser negocio manual/legacy`);
    }
  }
  await p.$disconnect();
})().catch((e) => { console.error(e.message); process.exit(1); });
