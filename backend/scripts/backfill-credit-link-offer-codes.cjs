// Setea HotmartCreditLink.hotmartOfferCode = el `?off=` de su propia url de
// checkout. Necesario para que el webhook distinga packs (1/10/20) que comparten
// el mismo hotmartProductId. Idempotente. Read-derived (no inventa datos).
//   railway run --service Postgres-Nq8w node scripts/backfill-credit-link-offer-codes.cjs
const { PrismaClient } = require('@prisma/client');

(async () => {
  const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
  if (!url) { console.error('No DATABASE_URL — railway run --service Postgres-Nq8w'); process.exit(1); }
  const prisma = new PrismaClient({ datasources: { db: { url } } });

  const links = await prisma.hotmartCreditLink.findMany();
  let updated = 0;
  for (const l of links) {
    const m = (l.url || '').match(/[?&]off=([^&]+)/i);
    const off = m ? m[1] : null;
    if (!off) { console.log(`SKIP ${l.label}: url sin ?off=`); continue; }
    if (l.hotmartOfferCode === off) { console.log(`OK (ya) ${l.label}: ${off}`); continue; }
    await prisma.hotmartCreditLink.update({ where: { id: l.id }, data: { hotmartOfferCode: off } });
    console.log(`SET ${l.label} (${l.credits} créditos): offerCode=${off}`);
    updated++;
  }
  console.log(`\n${updated} link(s) actualizados.`);
  await prisma.$disconnect();
})().catch(e => { console.error(e.message); process.exit(1); });
