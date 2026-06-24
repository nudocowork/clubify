// Configura los 2 planes de pago Stripe de Sellea (Mensual 68 / Anual 799).
// Aislado por marca: WhiteLabelPaymentLink de la marca 'sellea'. Idempotente
// (borra los links previos de Sellea y recrea los 2 correctos, para limpiar
// planes viejos/heredados). gateway de la marca = STRIPE.
//   railway run --service Postgres-Nq8w node scripts/setup-sellea-payment-links.cjs
const { PrismaClient } = require('@prisma/client');

const LINKS = [
  { name: 'Mensual', periodicity: 'MENSUAL', amountUsd: 68, url: 'https://buy.stripe.com/5kQaEY1uxeie3QjarL9R602', sortOrder: 0 },
  { name: 'Anual',   periodicity: 'ANUAL',   amountUsd: 799, url: 'https://buy.stripe.com/aFacN6ddf0ro2MffM59R601', sortOrder: 1 },
];

(async () => {
  const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
  if (!url) { console.error('No DATABASE_URL — railway run --service Postgres-Nq8w'); process.exit(1); }
  const prisma = new PrismaClient({ datasources: { db: { url } } });

  const wl = await prisma.whiteLabel.findFirst({ where: { slug: 'sellea' }, select: { id: true, paymentGateway: true } });
  if (!wl) { console.error('No existe la marca sellea'); process.exit(1); }

  // Asegura gateway STRIPE.
  if (wl.paymentGateway !== 'STRIPE') {
    await prisma.whiteLabel.update({ where: { id: wl.id }, data: { paymentGateway: 'STRIPE' } });
    console.log('gateway → STRIPE');
  }

  // Limpia links viejos/heredados de Sellea y recrea los 2 correctos.
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
  console.log(`\nSellea ahora tiene ${all.length} planes:`);
  for (const a of all) console.log(`  ${a.name} $${a.amountUsd} ${a.periodicity} active=${a.active}`);
  await prisma.$disconnect();
})().catch(e => { console.error(e.message); process.exit(1); });
