// Read-only. Bug #10 (currency Hotmart puede inflar comisiones).
//
// Inspecciona los payloads crudos de HotmartWebhookEvent para ver qué
// `purchase.price.currency_code` llegan en prod y con qué `value`. Si hay
// eventos con currency_code != USD, el código actual (que trata value como
// USD) está inflando subscriptionPriceUsd y la base de comisiones.
//
// También lista los Tenant.subscriptionPriceUsd "sospechosos" (fuera del
// bundle canónico 50/68/150/278/500 y > 600) que delatan una inflación.
//
// Uso: railway run --service Postgres-Nq8w node /ABS/PATH/diagnose-hotmart-currency.cjs
const { PrismaClient } = require('@prisma/client');

(async () => {
  const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
  if (!url) { console.error('No DATABASE_URL'); process.exit(1); }
  const prisma = new PrismaClient({ datasources: { db: { url } } });

  // 1) Distribución de currency_code en los webhooks guardados.
  const events = await prisma.hotmartWebhookEvent.findMany({
    select: { eventType: true, payload: true, processedAt: true, tenantId: true },
    orderBy: { processedAt: 'desc' },
    take: 5000,
  });
  console.log(`Eventos Hotmart analizados: ${events.length}\n`);

  const byCcy = new Map(); // ccy -> { count, samples:[] }
  let noPrice = 0;
  for (const e of events) {
    const p = e.payload || {};
    const price = p?.data?.purchase?.price;
    const value = price?.value;
    const ccy = (price?.currency_code || '(sin code)').toUpperCase();
    if (value == null) { noPrice++; continue; }
    if (!byCcy.has(ccy)) byCcy.set(ccy, { count: 0, samples: [] });
    const slot = byCcy.get(ccy);
    slot.count++;
    if (slot.samples.length < 5) {
      slot.samples.push({ value, type: e.eventType, at: e.processedAt?.toISOString?.()?.slice(0, 10) });
    }
  }

  console.log('=== currency_code en purchase.price ===');
  for (const [ccy, info] of [...byCcy.entries()].sort((a, b) => b[1].count - a[1].count)) {
    const flag = ccy !== 'USD' && ccy !== '(sin code)' ? '  ⚠️ NO-USD' : '';
    console.log(`  ${ccy.padEnd(12)} x${info.count}${flag}`);
    for (const s of info.samples) console.log(`      value=${s.value}  ${s.type}  ${s.at}`);
  }
  console.log(`  (eventos sin price.value: ${noPrice})\n`);

  // 2) Tenants con subscriptionPriceUsd sospechoso.
  const CANON = new Set([50, 68, 150, 278, 500]);
  const tenants = await prisma.tenant.findMany({
    where: { subscriptionPriceUsd: { not: null } },
    select: { id: true, brandName: true, subscriptionPriceUsd: true, planPeriodicity: true },
  });
  const suspicious = tenants.filter((t) => {
    const v = Number(t.subscriptionPriceUsd);
    return v > 600 || (!CANON.has(Math.round(v)) && v > 510);
  });
  console.log('=== Tenant.subscriptionPriceUsd sospechosos (>600 o fuera del bundle) ===');
  if (!suspicious.length) console.log('  ninguno ✅');
  for (const t of suspicious.sort((a, b) => Number(b.subscriptionPriceUsd) - Number(a.subscriptionPriceUsd))) {
    console.log(`  ${String(Number(t.subscriptionPriceUsd)).padStart(10)}  ${t.planPeriodicity || '?'}  ${t.brandName}  (${t.id})`);
  }
  console.log(`\n  total tenants con precio: ${tenants.length}, sospechosos: ${suspicious.length}`);

  // 3) Comisiones con amount muy alto (proxy de base inflada).
  const bigComms = await prisma.commission.findMany({
    where: { status: { not: 'REJECTED' }, amount: { gt: 100 } },
    select: { amount: true, createdAt: true, recipientCode: { select: { ownerName: true, role: true } } },
    orderBy: { amount: 'desc' },
    take: 20,
  });
  console.log('\n=== Top comisiones por monto (amount > 100 USD) ===');
  if (!bigComms.length) console.log('  ninguna ✅');
  for (const c of bigComms) {
    console.log(`  ${String(Number(c.amount)).padStart(10)}  ${c.recipientCode?.role || '?'}  ${c.recipientCode?.ownerName || '?'}  ${c.createdAt.toISOString().slice(0, 10)}`);
  }

  await prisma.$disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
