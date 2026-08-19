// SOLO-LECTURA: diagnostica el mapa de D'ponke. Marca/dominio (para la allowlist
// de la key de Maps) + si la marca tiene mapsApiKey propia + coords de la ubicación.
// Usage: railway run --service Postgres-Nq8w node scripts/diagnose-dponke-map.cjs
const { PrismaClient } = require('@prisma/client');

(async () => {
  const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  const tenants = await prisma.tenant.findMany({
    where: { OR: [
      { name: { contains: 'ponke', mode: 'insensitive' } },
      { slug: { contains: 'ponke', mode: 'insensitive' } },
      { brandName: { contains: 'ponke', mode: 'insensitive' } },
    ] },
    select: { id: true, name: true, slug: true, whiteLabelId: true, status: true },
  });
  if (!tenants.length) { console.log("No encontré tenant tipo D'ponke."); await prisma.$disconnect(); return; }

  for (const t of tenants) {
    console.log(`\n■ ${t.name}  (slug=${t.slug}, status=${t.status})  id=${t.id}`);
    // Marca + su key de maps + dominio
    if (t.whiteLabelId) {
      const wl = await prisma.whiteLabel.findUnique({
        where: { id: t.whiteLabelId },
        select: { name: true, slug: true, domain: true, appDomain: true, mapsApiKey: true },
      }).catch((e) => { console.log('  (query WhiteLabel falló:', e.message, ')'); return null; });
      console.log(`  marca: ${wl?.name ?? '?'} (slug=${wl?.slug}) · domain=${wl?.domain ?? '-'} · appDomain=${wl?.appDomain ?? '-'} · mapsApiKey propia: ${wl?.mapsApiKey ? 'SÍ ('+String(wl.mapsApiKey).slice(0,10)+'…)' : 'NO (usa la global)'}`);
    } else {
      console.log('  marca: Clubify (whiteLabelId null)');
    }
    // Ubicaciones + coords
    const locs = await prisma.location.findMany({
      where: { tenantId: t.id },
      select: { id: true, name: true, latitude: true, longitude: true, address: true },
    }).catch(() => []);
    if (!locs.length) console.log('  ubicaciones: (ninguna)');
    for (const l of locs) {
      const lat = Number(l.latitude), lng = Number(l.longitude);
      const bad =
        (lat === 0 && lng === 0) || Math.abs(lat) > 90 || Math.abs(lng) > 180
          ? ' ⚠️ COORDS SOSPECHOSAS'
          : '';
      console.log(`  ubicación "${l.name}": lat=${lat} lng=${lng}${bad}  addr=${(l.address ?? '').slice(0, 40)}`);
    }
  }
  await prisma.$disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
