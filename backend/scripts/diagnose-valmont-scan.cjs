// Read-only. Diagnostica por qué el scanner devuelve 400/no escanea en VALMONT.
// Muestra el formato del qrToken de los pases (QR-corto vs JWT-largo vs
// placeholder/null) + serial. El JWT largo no entra en el PDF417 → cámara negra.
//   railway run --service Postgres-Nq8w node /Users/jhonarias/Documents/AGENTES/CLUBIFY/backend/scripts/diagnose-valmont-scan.cjs
const { PrismaClient } = require('@prisma/client');
(async () => {
  const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
  const prisma = new PrismaClient({ datasources: { db: { url } } });

  const tenants = await prisma.tenant.findMany({
    where: { brandName: { contains: 'almont', mode: 'insensitive' } },
    select: { id: true, brandName: true, slug: true, status: true },
  });
  if (tenants.length === 0) { console.log('✗ VALMONT no encontrado'); process.exit(1); }

  for (const t of tenants) {
    console.log(`\n████ ${t.brandName} | slug=${t.slug} | ${t.id.slice(0, 8)} | ${t.status}`);
    const passes = await prisma.pass.findMany({
      where: { tenantId: t.id },
      select: {
        id: true, serialNumber: true, qrToken: true, status: true, issuedAt: true,
        walletPlatform: true, walletInstalledAt: true,
        googleObjectId: true, lastActivityAt: true,
        _count: { select: { walletDevices: true } },
      },
      orderBy: { issuedAt: 'desc' },
    });
    console.log(`  pases: ${passes.length}`);
    // Distribución por plataforma + cuántos tienen dispositivo registrado
    // (sin device registrado, el push de refresh NO puede llegar al celular).
    const plat = {}, withDev = { conDevice: 0, sinDevice: 0 };
    // #valmont: ¿los pases Google tienen googleObjectId? Sin él, el refresh
    // no puede patchear el barcode → queda viejo/ilegible.
    const goog = passes.filter((p) => p.walletPlatform === 'GOOGLE');
    const googObjId = { conObjId: 0, sinObjId: 0 };
    for (const p of passes) {
      const k = p.walletPlatform || 'sin-instalar';
      plat[k] = (plat[k] || 0) + 1;
      if (p._count.walletDevices > 0) withDev.conDevice++; else withDev.sinDevice++;
    }
    for (const p of goog) { if (p.googleObjectId) googObjId.conObjId++; else googObjId.sinObjId++; }
    console.log('  plataforma:', JSON.stringify(plat));
    console.log('  registro de dispositivo (para push):', JSON.stringify(withDev));
    console.log('  Google con googleObjectId (para patchear barcode):', JSON.stringify(googObjId));
    const fmt = (qt) => {
      if (!qt) return 'NULL/vacío';
      if (qt === 'placeholder') return 'placeholder(sin firmar)';
      if (qt.startsWith('QR-')) return 'QR-corto ✅';
      if (qt.split('.').length === 3) return `JWT-largo(${qt.length} chars) ⚠️`;
      return `otro(${qt.length} chars)`;
    };
    const dist = {};
    for (const p of passes) { const k = fmt(p.qrToken); dist[k] = (dist[k] || 0) + 1; }
    console.log('  distribución qrToken:', JSON.stringify(dist, null, 0));
    console.log('  muestra (últimos 8 — mirá los MÁS VIEJOS abajo):');
    const sample = [...passes.slice(0, 4), ...passes.slice(-4)];
    for (const p of sample) {
      const d = p.issuedAt ? new Date(p.issuedAt).toISOString().slice(0, 10) : '—';
      const gObj = p.walletPlatform === 'GOOGLE' ? ` | objId=${p.googleObjectId || '∅'}` : '';
      console.log(`    ${p.serialNumber} | ${d} | ${p.walletPlatform || 'no-inst'} | dev=${p._count.walletDevices} | tok=${p.qrToken}${gObj}`);
    }
  }
  await prisma.$disconnect();
  process.exit(0);
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });
