// Qué dice STRIPE de una suscripción de una marca: si tuvo prueba (`trial_end`),
// sus facturas y sus importes. Sirve para contrastar contra lo que el webhook
// dedujo — es la única forma de saber si `ctx.trialEnd` llegó vacío.
//
// Uso: railway run node scripts/mirar-suscripcion-stripe.cjs <slugMarca> <sub_...>
const { PrismaClient } = require('@prisma/client');
const Stripe = require('stripe');
const { decryptSecret } = require('../dist/common/crypto/secret-box');

const [slug, subId] = process.argv.slice(2);

(async () => {
  if (!slug || !subId) {
    console.error('uso: node scripts/mirar-suscripcion-stripe.cjs <slugMarca> <sub_...>');
    process.exit(1);
  }
  const prisma = new PrismaClient();
  const wl = await prisma.whiteLabel.findFirst({
    where: { slug },
    select: { id: true, slug: true, paymentGateway: true, paymentConfig: true },
  });
  if (!wl) { console.error('marca no encontrada'); process.exit(1); }
  const cfg = wl.paymentConfig || {};
  const stripe = new Stripe(decryptSecret(cfg.secretKey));

  const f = (s) => (typeof s === 'number' ? new Date(s * 1000).toISOString().replace('T', ' ').slice(0, 16) : '—');

  const sub = await stripe.subscriptions.retrieve(subId);
  console.log('SUSCRIPCIÓN', sub.id);
  console.log('  estado            ', sub.status);
  console.log('  creada            ', f(sub.created));
  console.log('  trial_start       ', f(sub.trial_start));
  console.log('  trial_end         ', f(sub.trial_end), sub.trial_end ? '' : '   ← SIN PRUEBA para el webhook');
  console.log('  periodo actual    ', f(sub.current_period_start), '→', f(sub.current_period_end));
  console.log('  price             ', sub.items?.data?.[0]?.price?.id, sub.items?.data?.[0]?.price?.unit_amount);

  const invs = await stripe.invoices.list({ subscription: subId, limit: 20 });
  console.log(`\nFACTURAS (${invs.data.length})`);
  for (const i of invs.data) {
    console.log(`  ${f(i.created)}  ${i.id}  ${i.status}  pagado=$${(i.amount_paid ?? 0) / 100}  billing_reason=${i.billing_reason}`);
  }

  await prisma.$disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
