// Diagnóstico GEOPUSH (read-only). Por cada negocio con ubicaciones:
//  - valida coords/radio (el pase FILTRA coords inválidas → sin geofence)
//  - cuenta pases no-REVOKED = cuántos wallets refrescaría el nuevo hook al
//    crear/editar una Location (locations.service.refreshTenantWallets)
// NO modifica nada. Usage:
//   railway run --service Postgres-Nq8w node scripts/diagnose-geopush.cjs
const { PrismaClient } = require('@prisma/client');

function coordStatus(lat, lng) {
  const la = lat == null ? NaN : Number(lat);
  const ln = lng == null ? NaN : Number(lng);
  if (!Number.isFinite(la) || !Number.isFinite(ln)) return 'INVÁLIDA (no numérica)';
  if (la === 0 && ln === 0) return 'INVÁLIDA (0,0)';
  if (la < -90 || la > 90 || ln < -180 || ln > 180) return 'INVÁLIDA (fuera de rango)';
  return 'ok';
}

(async () => {
  const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
  if (!url) {
    console.error('No DATABASE_URL — corré con `railway run --service Postgres-Nq8w`');
    process.exit(1);
  }
  console.log('Connecting to:', url.replace(/:\/\/[^@]+@/, '://***:***@'));
  const prisma = new PrismaClient({ datasources: { db: { url } } });

  const locs = await prisma.location.findMany({
    select: {
      id: true, name: true, latitude: true, longitude: true,
      radiusMeters: true, walletRelevantText: true, tenantId: true,
      tenant: { select: { brandName: true, slug: true } },
    },
    orderBy: { tenantId: 'asc' },
  });

  if (locs.length === 0) {
    console.log('\nNo hay ubicaciones GeoPush en la base.');
    await prisma.$disconnect();
    return;
  }

  // Agrupar por tenant
  const byTenant = new Map();
  for (const l of locs) {
    if (!byTenant.has(l.tenantId)) byTenant.set(l.tenantId, { tenant: l.tenant, list: [] });
    byTenant.get(l.tenantId).list.push(l);
  }

  let totalBad = 0;
  let totalPasses = 0;
  console.log(`\n${byTenant.size} negocio(s) con ubicaciones · ${locs.length} ubicación(es) total\n`);

  for (const [tenantId, { tenant, list }] of byTenant) {
    const passes = await prisma.pass.count({
      where: { tenantId, status: { not: 'REVOKED' } },
    });
    totalPasses += passes;
    const label = tenant?.brandName || tenant?.slug || tenantId;
    console.log(`■ ${label}  →  ${passes} pase(s) recibirían el geofence al refrescar`);
    for (const l of list) {
      const st = coordStatus(l.latitude, l.longitude);
      if (st !== 'ok') totalBad++;
      const flag = st === 'ok' ? '  ' : '⚠️';
      console.log(
        `   ${flag} ${l.name || '(sin nombre)'} · ${Number(l.latitude)},${Number(l.longitude)} · r=${l.radiusMeters}m · ${st}` +
        (l.walletRelevantText ? ` · texto:"${l.walletRelevantText}"` : ' · (sin texto push)'),
      );
    }
  }

  console.log(`\nResumen: ${locs.length} ubicaciones, ${totalBad} con coords inválidas, ${totalPasses} pases activos en total.`);
  if (totalBad > 0) {
    console.log('⚠️  Las ubicaciones inválidas NO generan geofence (el pase las filtra). Corregir sus coordenadas.');
  } else {
    console.log('✅ Todas las coordenadas son válidas → geofence correcto en el pase.');
  }
  await prisma.$disconnect();
})();
