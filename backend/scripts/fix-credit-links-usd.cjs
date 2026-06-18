// Normaliza la moneda de los links de compra de créditos Hotmart a USD.
// La plataforma factura 100% en USD; filas legacy quedaron con 'MXN'.
// Usage: railway run --service Postgres-Nq8w node scripts/fix-credit-links-usd.cjs
const { PrismaClient } = require('@prisma/client');
(async () => {
  const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
  if (!url) {
    console.error('No DATABASE_URL');
    process.exit(1);
  }
  const prisma = new PrismaClient({ datasources: { db: { url } } });

  const before = await prisma.hotmartCreditLink.findMany({
    select: { id: true, label: true, price: true, currency: true },
    orderBy: { position: 'asc' },
  });
  console.log('\nAntes:');
  for (const l of before) {
    console.log(`  ${l.label} — ${l.price ?? '—'} ${l.currency}`);
  }

  const res = await prisma.hotmartCreditLink.updateMany({
    where: { currency: { not: 'USD' } },
    data: { currency: 'USD' },
  });
  console.log(`\n✅ Filas actualizadas a USD: ${res.count}`);

  const after = await prisma.hotmartCreditLink.findMany({
    select: { label: true, price: true, currency: true },
    orderBy: { position: 'asc' },
  });
  console.log('\nDespués:');
  for (const l of after) {
    console.log(`  ${l.label} — ${l.price ?? '—'} ${l.currency}`);
  }
  await prisma.$disconnect();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
