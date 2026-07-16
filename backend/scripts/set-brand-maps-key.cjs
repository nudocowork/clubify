// Setea o LIMPIA la WhiteLabel.mapsApiKey de una marca.
//   Limpiar (usa la key global): BRAND=sellea APPLY=1 railway run ... node scripts/set-brand-maps-key.cjs
//   Setear una key propia:        BRAND=sellea MAPS_KEY=AIza... APPLY=1 railway run ... node ...
// Sin APPLY = dry-run (solo muestra el valor actual).
const { PrismaClient } = require('@prisma/client');

const BRAND = (process.env.BRAND || 'sellea').trim();
const NEW = process.env.MAPS_KEY !== undefined ? (process.env.MAPS_KEY.trim() || null) : null;
const APPLY = process.env.APPLY === '1';

(async () => {
  const p = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL } } });
  const wl = await p.whiteLabel.findFirst({
    where: { OR: [{ slug: { contains: BRAND, mode: 'insensitive' } }, { name: { contains: BRAND, mode: 'insensitive' } }] },
    select: { id: true, name: true, slug: true, mapsApiKey: true },
  });
  if (!wl) { console.error(`No se encontró marca "${BRAND}"`); process.exit(1); }

  const cur = wl.mapsApiKey ? wl.mapsApiKey.slice(0, 12) + '…' : 'null (usa global)';
  const next = NEW ? NEW.slice(0, 12) + '…' : 'null (usa global)';
  console.log(`Marca: ${wl.name} (${wl.slug})`);
  console.log(`mapsApiKey actual: ${cur}`);
  console.log(`mapsApiKey nuevo:  ${next}`);

  if (!APPLY) { console.log('\nDRY-RUN. Correr con APPLY=1 para aplicar.'); await p.$disconnect(); return; }
  await p.whiteLabel.update({ where: { id: wl.id }, data: { mapsApiKey: NEW } });
  console.log(`\n✅ Aplicado. Ahora la marca usa: ${next}`);
  await p.$disconnect();
})().catch((e) => { console.error(e.message); process.exit(1); });
