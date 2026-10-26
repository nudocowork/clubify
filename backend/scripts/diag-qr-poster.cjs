// Carteles QR de un negocio: tipo, a dónde apunta el QR que dibuja el editor y qué hay en el diseño.
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
(async () => {
  const t = await prisma.tenant.findFirst({ where: { OR: [{ slug: { contains: process.argv[2], mode: 'insensitive' } }, { name: { contains: process.argv[2], mode: 'insensitive' } }] }, select: { id: true, name: true, slug: true } });
  console.log(t);
  const ps = await prisma.qrPoster.findMany({ where: { tenantId: t.id }, select: { id: true, type: true, name: true, targetUrl: true, isActive: true, updatedAt: true, config: true, lastExportUrl: true, _count: { select: { visits: true } } } });
  for (const p of ps) {
    const c = p.config || {};
    const txt = JSON.stringify(c);
    console.log(`\n${p.type} «${p.name}» id=${p.id} activo=${p.isActive} target=${p.targetUrl} visitas=${p._count.visits} actualizado=${p.updatedAt.toISOString()}`);
    console.log('  claves config:', Object.keys(c).join(', '));
    const urls = [...new Set(txt.match(/https?:\/\/[^"\ ]+/g) || [])].slice(0, 12);
    console.log('  urls en config:', urls.join('  '));
    for (const k of ['qrUrl', 'qrTarget', 'cardId', 'target', 'url', 'variant', 'mode']) if (c[k] !== undefined) console.log(`  ${k}:`, JSON.stringify(c[k]).slice(0, 200));
    const capas = c.layers || c.elements || c.objects || [];
    if (Array.isArray(capas)) console.log('  capas:', capas.map((l) => `${l.type || l.kind}${l.src ? '(img)' : ''}`).join(', '));
  }
  const cards = await prisma.card.findMany({ where: { tenantId: t.id }, select: { id: true, name: true, isActive: true } });
  console.log('\ntarjetas:', JSON.stringify(cards));
})().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
