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
      select: { id: true, serialNumber: true, qrToken: true, status: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    });
    console.log(`  pases: ${passes.length}`);
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
    console.log('  muestra (últimos 5):');
    for (const p of passes.slice(0, 5)) {
      console.log(`    ${p.serialNumber} | ${p.status} | qrToken=${(p.qrToken || '∅').slice(0, 24)}${(p.qrToken || '').length > 24 ? '…' : ''} [${fmt(p.qrToken)}]`);
    }
  }
  await prisma.$disconnect();
  process.exit(0);
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });
