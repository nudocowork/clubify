// Configura los planes de pago Stripe de Fideliso. Espejo de
// setup-sellea-payment-links.cjs. Aislado por marca (slug 'fideliso').
// Idempotente: borra los links previos de Fideliso y recrea los de LINKS.
// gateway de la marca = STRIPE.
//
// ⚠️ Reemplazá las URLs de Stripe (buy.stripe.com/...) por las de la cuenta
//    Stripe de Fideliso ANTES de correr. Las que están son placeholders.
//   railway run --service Postgres-Nq8w node /ABS/PATH/backend/scripts/setup-fideliso-payment-links.cjs
const { PrismaClient } = require('@prisma/client');

const LINKS = [
  { name: 'Mensual', periodicity: 'MENSUAL', amountUsd: 68,  url: 'REEMPLAZAR_STRIPE_MENSUAL', sortOrder: 0 },
  { name: 'Anual',   periodicity: 'ANUAL',   amountUsd: 499, url: 'REEMPLAZAR_STRIPE_ANUAL',   sortOrder: 1 },
];

(async () => {
  const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
  if (!url) { console.error('No DATABASE_URL — railway run --service Postgres-Nq8w'); process.exit(1); }

  if (LINKS.some((l) => l.url.startsWith('REEMPLAZAR_'))) {
    console.error('⛔ Faltan las URLs de Stripe de Fideliso. Editá LINKS[] antes de correr.');
    process.exit(1);
  }

  const prisma = new PrismaClient({ datasources: { db: { url } } });
  const wl = await prisma.whiteLabel.findFirst({ where: { slug: 'fideliso' }, select: { id: true, paymentGateway: true } });
  if (!wl) { console.error('No existe la marca fideliso'); process.exit(1); }

  if (wl.paymentGateway !== 'STRIPE') {
    await prisma.whiteLabel.update({ where: { id: wl.id }, data: { paymentGateway: 'STRIPE' } });
    console.log('gateway → STRIPE');
  }

  const del = await prisma.whiteLabelPaymentLink.deleteMany({ where: { whiteLabelId: wl.id } });
  console.log(`borrados ${del.count} links previos`);

  for (const l of LINKS) {
    const created = await prisma.whiteLabelPaymentLink.create({
      data: {
        whiteLabelId: wl.id,
        gateway: 'STRIPE',
        name: l.name,
        periodicity: l.periodicity,
        amountUsd: l.amountUsd,
        url: l.url,
        active: true,
        sortOrder: l.sortOrder,
      },
    });
    console.log(`✅ ${created.name} $${l.amountUsd} ${l.periodicity} → ${l.url}`);
  }

  const all = await prisma.whiteLabelPaymentLink.findMany({ where: { whiteLabelId: wl.id }, orderBy: { sortOrder: 'asc' } });
  console.log(`\nFideliso ahora tiene ${all.length} planes:`);
  for (const a of all) console.log(`  ${a.name} $${a.amountUsd} ${a.periodicity} active=${a.active}`);
  await prisma.$disconnect();
})().catch(e => { console.error(e.message); process.exit(1); });
