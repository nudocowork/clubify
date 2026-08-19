// READ-ONLY: inspecciona los botones del InfoLink de DINOROLLS para ver si
// tienen datos de estilo v2 (o siguen legacy).
const { PrismaClient } = require('@prisma/client');
const V2KEYS = ['buttonShape', 'borderRadius', 'glass', 'iconType', 'iconName',
  'customIconUrl', 'iconPosition', 'iconSize', 'iconBackground', 'backgroundColor',
  'textColor', 'textAlignment', 'borderColor', 'shadow'];
(async () => {
  const p = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL } } });
  const links = await p.infoLink.findMany({
    where: { tenant: { brandName: { contains: 'dino', mode: 'insensitive' } } },
    select: { id: true, buttons: true, updatedAt: true, theme: true, tenant: { select: { brandName: true, slug: true } } },
  });
  if (!links.length) { console.log('No hay InfoLink para DINOROLLS.'); await p.$disconnect(); return; }
  for (const l of links) {
    const btns = Array.isArray(l.buttons) ? l.buttons : [];
    const layout = (l.theme && (l.theme.template || l.theme.shell || l.theme.layout)) || '—';
    console.log(`\n=== ${l.tenant?.brandName} (slug=${l.tenant?.slug}) · shell=${layout} · ${btns.length} botones · updated ${l.updatedAt.toISOString().slice(0, 10)} ===`);
    btns.forEach((b, i) => {
      const v2 = V2KEYS.filter((k) => b && b[k] !== undefined && b[k] !== null);
      console.log(`  [${i}] ${(b.label || b.title || b.text || '—')}  →  ${v2.length ? 'v2: ' + v2.join(',') : 'LEGACY (sin estilo v2)'}`);
    });
  }
  await p.$disconnect();
})().catch((e) => { console.error(e.message); process.exit(1); });
