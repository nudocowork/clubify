// Backfill: asigna los HotmartCreditLink legacy (whiteLabelId NULL) a la marca
// 'clubify'. Los packs existentes (1/10/20, product 7929341) son de Clubify;
// con la acreditación por relación directa (product+offer → marca) deben
// apuntar a clubify. Idempotente.
//   railway run --service Postgres-Nq8w node scripts/backfill-credit-links-to-clubify.cjs
const { PrismaClient } = require('@prisma/client');

(async () => {
  const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
  if (!url) { console.error('No DATABASE_URL — railway run --service Postgres-Nq8w'); process.exit(1); }
  const prisma = new PrismaClient({ datasources: { db: { url } } });

  const clubify = await prisma.whiteLabel.findFirst({ where: { slug: 'clubify' }, select: { id: true } });
  if (!clubify) { console.error('No existe la marca clubify'); process.exit(1); }

  const before = await prisma.hotmartCreditLink.count({ where: { whiteLabelId: null } });
  console.log(`links con whiteLabelId NULL: ${before}`);
  if (before > 0) {
    const r = await prisma.hotmartCreditLink.updateMany({
      where: { whiteLabelId: null },
      data: { whiteLabelId: clubify.id },
    });
    console.log(`✅ ${r.count} links → clubify (${clubify.id}).`);
  } else {
    console.log('Nada para backfillear.');
  }

  const links = await prisma.hotmartCreditLink.findMany({
    select: { credits: true, hotmartProductId: true, hotmartOfferCode: true, whiteLabelId: true, label: true },
    orderBy: { credits: 'asc' },
  });
  console.log('\n=== estado final ===');
  for (const l of links) {
    console.log(`${String(l.credits).padStart(3)} créditos | prod=${l.hotmartProductId} offer=${l.hotmartOfferCode} | wl=${l.whiteLabelId}`);
  }
  await prisma.$disconnect();
})().catch(e => { console.error(e.message); process.exit(1); });
