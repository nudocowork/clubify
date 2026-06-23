// Audit de aislamiento de pagos por marca (read-only). Verifica que:
//  1) Ningún hotmartSubscriberCode esté en tenants de >1 marca.
//  2) Ningún stripeCustomerId / stripeSubscriptionId cruce marcas.
//  3) Lista, por marca: pasarela + nº de links + nº de tenants.
// Un identificador compartido entre marcas = riesgo de que un webhook de A
// active el tenant de B (lo que Fase 5 cierra a nivel de código).
//
// Usage: railway run --service Postgres-Nq8w node /ABS/PATH/backend/scripts/diagnose-payment-isolation.cjs
const { PrismaClient } = require('@prisma/client');

(async () => {
  const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
  if (!url) { console.error('No DATABASE_URL'); process.exit(1); }
  const prisma = new PrismaClient({ datasources: { db: { url } } });

  const brands = await prisma.whiteLabel.findMany({
    select: { id: true, slug: true, name: true, paymentGateway: true, _count: { select: { tenants: true, paymentLinks: true } } },
    orderBy: { slug: 'asc' },
  });
  console.log('=== Marcas ===');
  for (const b of brands) {
    console.log(`• ${b.slug} (${b.name}) — pasarela=${b.paymentGateway} · tenants=${b._count.tenants} · links=${b._count.paymentLinks}`);
  }

  // Helper: detecta un identificador presente en >1 whiteLabelId distinto.
  async function checkField(field) {
    const rows = await prisma.tenant.findMany({
      where: { [field]: { not: null } },
      select: { id: true, brandName: true, whiteLabelId: true, [field]: true },
    });
    const byVal = new Map();
    for (const r of rows) {
      const v = r[field];
      if (!byVal.has(v)) byVal.set(v, new Set());
      byVal.get(v).add(r.whiteLabelId ?? 'null');
    }
    const collisions = [...byVal.entries()].filter(([, brandsSet]) => brandsSet.size > 1);
    if (collisions.length === 0) {
      console.log(`✅ ${field}: sin colisiones entre marcas (${rows.length} con valor).`);
    } else {
      console.log(`🚨 ${field}: ${collisions.length} valor(es) compartidos entre marcas:`);
      for (const [v, brandsSet] of collisions) {
        console.log(`   - ${v} → marcas: ${[...brandsSet].join(', ')}`);
      }
    }
  }

  console.log('\n=== Aislamiento de identificadores de pago ===');
  await checkField('hotmartSubscriberCode');
  await checkField('stripeCustomerId');
  await checkField('stripeSubscriptionId');

  // Links de Stripe: ningún price_id debería repetirse entre marcas.
  const links = await prisma.whiteLabelPaymentLink.findMany({
    where: { stripePriceId: { not: null } },
    select: { stripePriceId: true, whiteLabelId: true },
  });
  const byPrice = new Map();
  for (const l of links) {
    if (!byPrice.has(l.stripePriceId)) byPrice.set(l.stripePriceId, new Set());
    byPrice.get(l.stripePriceId).add(l.whiteLabelId);
  }
  const priceCollisions = [...byPrice.entries()].filter(([, s]) => s.size > 1);
  console.log(
    priceCollisions.length === 0
      ? `✅ stripePriceId (links): sin colisiones entre marcas (${links.length} con valor).`
      : `🚨 stripePriceId compartido entre marcas: ${priceCollisions.map(([p]) => p).join(', ')}`,
  );

  await prisma.$disconnect();
  console.log('\nListo.');
})().catch((e) => { console.error(e); process.exit(1); });
