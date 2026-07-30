// SOLO LECTURA. Vuelca en crudo los botones del infolink de empanadas-la-parada
// para diagnosticar el botón WhatsApp mal guardado (type=EXTERNAL, waPhone='+58').
//   railway run --service Postgres-Nq8w node scripts/inspect-empanadas-infolink-raw.cjs
const { PrismaClient } = require('@prisma/client');
(async () => {
  const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
  if (!url) { console.error('No DATABASE_URL'); process.exit(1); }
  const prisma = new PrismaClient({ datasources: { db: { url } } });

  const t = await prisma.tenant.findFirst({
    where: { slug: 'empanadas-la-parada' },
    select: { id: true, name: true, whatsappPhone: true },
  });
  if (!t) { console.log('tenant no encontrado'); await prisma.$disconnect(); return; }
  console.log('Tenant:', t.name, '| whatsappPhone:', JSON.stringify(t.whatsappPhone));

  const link = await prisma.infoLink.findFirst({
    where: { tenantId: t.id, slug: 'infolink' },
    select: { id: true, slug: true, updatedAt: true, buttons: true },
  });
  if (!link) { console.log('infolink no encontrado'); await prisma.$disconnect(); return; }
  console.log('Link:', link.slug, '| updatedAt:', link.updatedAt.toISOString());
  const btns = Array.isArray(link.buttons) ? link.buttons : [];
  console.log(`\n=== ${btns.length} botones (crudo) ===`);
  btns.forEach((b, i) => {
    console.log(`\n[${i}] ${JSON.stringify(b, null, 2)}`);
  });
  await prisma.$disconnect();
})().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
