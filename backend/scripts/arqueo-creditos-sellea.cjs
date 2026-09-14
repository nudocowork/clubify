// Por qué Sellea no ha consumido créditos desde el 29 de agosto.
//
// Para cada negocio de Sellea creado o activado en los últimos 60 días imprime
// por qué camino entró (el prefijo de `hotmartSubscriberCode` lo delata: wl- =
// alta del panel de marca, manual-/comp-/trial- = simulador, un id de Stripe =
// pago) y si hay un movimiento de crédito asociado.
//
// Uso: railway run --service Postgres-Nq8w node scripts/arqueo-creditos-sellea.cjs
const { PrismaClient } = require('@prisma/client');

(async () => {
  const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
  const prisma = new PrismaClient({ datasources: { db: { url } } });

  const wl = await prisma.whiteLabel.findFirst({
    where: { slug: 'sellea' },
    select: { id: true, name: true, creditsAvailable: true, creditsUsed: true, creditsUnlimited: true },
  });
  console.log('MARCA:', JSON.stringify(wl));

  const desde = new Date(Date.now() - 60 * 86400000);
  const negocios = await prisma.tenant.findMany({
    where: { whiteLabelId: wl.id, createdAt: { gte: desde } },
    select: {
      id: true, brandName: true, status: true, createdAt: true,
      hotmartSubscriberCode: true, stripeSubscriptionId: true,
      businessType: true, infolinkTier: true, planPeriodicity: true,
      lastChargeAt: true, purchasedAt: true, currentPeriodEnd: true, trialEndsAt: true,
    },
    orderBy: { createdAt: 'asc' },
  });

  const movs = await prisma.creditTransaction.findMany({
    where: { whiteLabelId: wl.id, createdAt: { gte: desde } },
    select: { id: true, type: true, amount: true, tenantId: true, note: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  });
  const porNegocio = new Map();
  for (const m of movs) if (m.tenantId) {
    if (!porNegocio.has(m.tenantId)) porNegocio.set(m.tenantId, []);
    porNegocio.get(m.tenantId).push(m);
  }

  const f = (d) => (d ? new Date(d).toISOString().slice(0, 10) : '—');
  console.log(`\nNEGOCIOS DE SELLEA CREADOS EN 60 DÍAS (${negocios.length})`);
  for (const t of negocios) {
    const ms = porNegocio.get(t.id) ?? [];
    console.log(
      `\n· ${t.brandName}  [${t.status}]  creado ${f(t.createdAt)}` +
      `\n    código=${t.hotmartSubscriberCode ?? '—'}  stripeSub=${t.stripeSubscriptionId ?? '—'}` +
      `\n    tipo=${t.businessType ?? '—'}/${t.infolinkTier ?? '—'}  periodicidad=${t.planPeriodicity ?? 'NULL'}` +
      `\n    lastChargeAt=${f(t.lastChargeAt)}  purchasedAt=${f(t.purchasedAt)}  fin=${f(t.currentPeriodEnd)}  trial=${f(t.trialEndsAt)}` +
      `\n    créditos: ${ms.length ? ms.map((m) => `${m.type} ${m.amount} (${f(m.createdAt)})`).join(' · ') : 'NINGUNO'}`,
    );
  }

  console.log(`\nMOVIMIENTOS DE CRÉDITO DE LA MARCA EN 60 DÍAS (${movs.length})`);
  for (const m of movs) {
    console.log(`  ${f(m.createdAt)}  ${m.type.padEnd(10)} ${String(m.amount).padStart(7)}  ${m.note ?? ''}`);
  }

  await prisma.$disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
