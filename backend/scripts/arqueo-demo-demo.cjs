// La cuenta «demo demo» de Sellea: pagó por Stripe y no consumió crédito.
// Uso: railway run --service Postgres-Nq8w node scripts/arqueo-demo-demo.cjs
const { PrismaClient } = require('@prisma/client');

(async () => {
  const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  const f = (d) => (d ? new Date(d).toISOString().replace('T', ' ').slice(0, 16) : '—');

  const t = await prisma.tenant.findFirst({
    where: { brandName: { contains: 'demo demo', mode: 'insensitive' } },
  });
  if (!t) { console.log('no está'); return; }
  console.log('NEGOCIO');
  for (const k of ['id','brandName','slug','email','status','createdAt','trialStartedAt','trialEndsAt',
                   'currentPeriodEnd','lastChargeAt','purchasedAt','suspendedAt','failedPaymentCount',
                   'firstFailedAt','stripeCustomerId','stripeSubscriptionId','planPeriodicity',
                   'businessType','infolinkTier','lastPaymentAmountUsd','whiteLabelId']) {
    console.log(`  ${k.padEnd(22)} ${t[k] instanceof Date ? f(t[k]) : String(t[k])}`);
  }

  const ing = await prisma.incomeRecord.findMany({
    where: { tenantId: t.id },
    select: { id: true, gateway: true, externalTxId: true, grossUsd: true, netReceivedUsd: true,
              status: true, saleDate: true, isFirstPayment: true, planPeriodicity: true, createdAt: true },
    orderBy: { saleDate: 'asc' },
  });
  console.log(`\nINGRESOS (${ing.length})`);
  for (const i of ing) {
    console.log(`  ${f(i.saleDate)}  ${i.gateway}  $${i.grossUsd}  ${i.status}  primero=${i.isFirstPayment}  per=${i.planPeriodicity ?? 'NULL'}  tx=${i.externalTxId ?? '—'}`);
  }

  const logs = await prisma.auditLog.findMany({
    where: { OR: [{ entityId: t.id }, { metadata: { path: ['tenantId'], equals: t.id } }] },
    select: { action: true, createdAt: true, metadata: true },
    orderBy: { createdAt: 'asc' },
    take: 60,
  }).catch((e) => { console.log('auditLog:', e.message); return []; });
  console.log(`\nAUDITORÍA (${logs.length})`);
  for (const l of logs) console.log(`  ${f(l.createdAt)}  ${l.action}  ${JSON.stringify(l.metadata ?? {})}`);

  const cfg = await prisma.setting.findMany({
    where: { key: { startsWith: 'landing.trial.' } },
    select: { key: true, value: true },
  });
  console.log('\nCONFIG DE PRUEBA POR MARCA');
  for (const c of cfg) console.log(`  ${c.key} = ${(c.value ?? '').slice(0, 80)}`);

  const links = await prisma.whiteLabelPaymentLink.findMany({
    where: { whiteLabel: { slug: 'sellea' } },
    select: { periodicity: true, amountUsd: true, active: true, productKey: true, stripePriceId: true, url: true },
  });
  console.log('\nLINKS DE PAGO DE SELLEA');
  for (const l of links) {
    console.log(`  ${String(l.periodicity).padEnd(10)} $${l.amountUsd}  activo=${l.active}  producto=${l.productKey ?? '—'}  priceId=${l.stripePriceId ?? 'NULL'}`);
  }

  await prisma.$disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
