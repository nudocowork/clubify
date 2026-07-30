// SOLO LECTURA. Inspecciona los botones de los InfoLinks de Sellea para ver si
// el waPhone de los botones WhatsApp realmente se está guardando. NO escribe
// nada. Diagnóstico del bug "el botón de WhatsApp no funciona".
//   railway run --service Postgres-Nq8w node scripts/inspect-sellea-infolink-buttons.cjs
const { PrismaClient } = require('@prisma/client');
(async () => {
  const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
  if (!url) { console.error('No DATABASE_URL'); process.exit(1); }
  const prisma = new PrismaClient({ datasources: { db: { url } } });

  // 1) Marca Sellea (por slug o nombre).
  const wl = await prisma.whiteLabel.findFirst({
    where: { OR: [{ slug: 'sellea' }, { name: { contains: 'ellea', mode: 'insensitive' } }] },
    select: { id: true, name: true, slug: true },
  });
  console.log('Marca:', wl ?? '(no encontrada)');
  if (!wl) { await prisma.$disconnect(); return; }

  // 2) Tenants de Sellea.
  const tenants = await prisma.tenant.findMany({
    where: { whiteLabelId: wl.id },
    select: { id: true, name: true, slug: true, whatsappPhone: true },
  });
  console.log(`Negocios de ${wl.name}: ${tenants.length}`);

  // 3) InfoLinks de esos tenants con sus botones.
  const links = await prisma.infoLink.findMany({
    where: { tenantId: { in: tenants.map((t) => t.id) } },
    select: { id: true, slug: true, tenantId: true, title: true, buttons: true, updatedAt: true, isActive: true },
    orderBy: { updatedAt: 'desc' },
    take: 40,
  });
  console.log(`InfoLinks: ${links.length}\n`);

  const tById = new Map(tenants.map((t) => [t.id, t]));
  let waTotal = 0, waWithPhone = 0, waEmpty = 0;

  for (const l of links) {
    const t = tById.get(l.tenantId);
    const btns = Array.isArray(l.buttons) ? l.buttons : [];
    const wa = btns.filter((b) => b && b.type === 'WHATSAPP');
    if (wa.length === 0) continue;
    console.log(`— /i/${t?.slug}/${l.slug}  "${l.title}"  (act=${l.isActive}, upd=${l.updatedAt.toISOString().slice(0,10)}, tenant.whatsappPhone=${t?.whatsappPhone ?? 'null'})`);
    for (const b of wa) {
      waTotal++;
      const hasPhone = !!(b.waPhone && String(b.waPhone).trim());
      if (hasPhone) waWithPhone++; else waEmpty++;
      const digits = String(b.waPhone || '').replace(/\D/g, '');
      console.log(`    · label="${b.label}"  waPhone=${JSON.stringify(b.waPhone ?? null)}  → wa.me/${digits || '(VACÍO)'}  isActive=${b.isActive}  keys=[${Object.keys(b).join(',')}]`);
    }
  }

  console.log(`\nRESUMEN botones WhatsApp: total=${waTotal}  conNúmero=${waWithPhone}  SIN número=${waEmpty}`);
  await prisma.$disconnect();
})().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
