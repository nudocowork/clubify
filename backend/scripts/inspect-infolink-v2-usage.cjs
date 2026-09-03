// READ-ONLY: ¿algún InfoLink usa estilo v2? ¿existe la página de la captura
// (botones DinoDelivery / Google Search / 7 botones) en la DB?
const { PrismaClient } = require('@prisma/client');
const V2KEYS = ['buttonShape', 'borderRadius', 'glass', 'iconType', 'iconName', 'customIconUrl', 'backgroundColor', 'textAlignment'];
const hasV2 = (b) => b && V2KEYS.some((k) => b[k] !== undefined && b[k] !== null);
(async () => {
  const p = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL } } });
  const all = await p.infoLink.findMany({
    select: { buttons: true, updatedAt: true, tenant: { select: { brandName: true, slug: true } } },
  });
  let withV2 = 0, total = all.length;
  const hits = [];
  for (const l of all) {
    const btns = Array.isArray(l.buttons) ? l.buttons : [];
    if (btns.some(hasV2)) { withV2++; hits.push(`${l.tenant?.brandName} (${btns.length} btns)`); }
    // ¿página de la captura?
    const labels = btns.map((b) => (b.label || b.title || b.text || '').toLowerCase());
    if (labels.some((x) => x.includes('dinodelivery') || x.includes('google search'))) {
      console.log(`>>> PÁGINA DE LA CAPTURA? ${l.tenant?.brandName} (slug=${l.tenant?.slug}) · ${btns.length} botones: ${btns.map((b) => b.label || b.title || b.text).join(' | ')}`);
    }
  }
  console.log(`\nInfoLinks totales: ${total} · con estilo v2 aplicado: ${withV2}`);
  if (withV2) console.log('  → ' + hits.join(' · '));
  await p.$disconnect();
})().catch((e) => { console.error(e.message); process.exit(1); });
