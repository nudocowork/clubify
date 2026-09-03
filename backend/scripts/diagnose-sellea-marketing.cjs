// SOLO-LECTURA: encuentra la(s) marca(s) tipo Sellea, su slug (para la URL del
// webhook) y si tienen subcuenta de envío (Grow Business) configurada.
// Usage: railway run --service Postgres-Nq8w node scripts/diagnose-sellea-marketing.cjs
const { PrismaClient } = require('@prisma/client');

(async () => {
  const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
  const prisma = new PrismaClient({ datasources: { db: { url } } });

  const rows = await prisma.whiteLabel.findMany({
    where: { OR: [
      { slug: { contains: 'sell', mode: 'insensitive' } },
      { name: { contains: 'sell', mode: 'insensitive' } },
      { slug: { contains: 'fidel', mode: 'insensitive' } },
    ] },
    select: {
      id: true, slug: true, name: true,
      growBusinessLocationId: true, growBusinessApiKey: true, growBusinessSwitchNumber: true,
    },
    orderBy: { slug: 'asc' },
  });

  if (!rows.length) { console.log('No encontré marcas tipo Sellea/Fidel.'); }
  for (const w of rows) {
    const hasSub = !!(w.growBusinessLocationId && w.growBusinessApiKey);
    console.log(`\n■ ${w.name}  (slug=${w.slug})`);
    console.log(`  whiteLabelId: ${w.id}`);
    console.log(`  Subcuenta de envío: ${hasSub ? '✓ configurada' : '✗ FALTA (no podrá enviar)'}`);
    if (hasSub) console.log(`    locationId=${w.growBusinessLocationId}  switch=${w.growBusinessSwitchNumber ?? '(default)'}`);
    console.log(`  Webhook a registrar: https://api.soyclubify.com/webhooks/email-inbound/${w.slug}`);
  }
  await prisma.$disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
