// SOLO LECTURA. Escanea TODOS los InfoLinks de la plataforma y reporta cuántos
// botones WhatsApp tienen waPhone vacío vs. con número, ordenado por fecha de
// actualización. Diagnóstico: ¿es sistémico que el número no se guarda?
//   railway run --service Postgres-Nq8w node scripts/inspect-whatsapp-buttons-platform.cjs
const { PrismaClient } = require('@prisma/client');
(async () => {
  const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
  if (!url) { console.error('No DATABASE_URL'); process.exit(1); }
  const prisma = new PrismaClient({ datasources: { db: { url } } });

  const links = await prisma.infoLink.findMany({
    select: { id: true, slug: true, title: true, buttons: true, updatedAt: true, tenantId: true },
    orderBy: { updatedAt: 'desc' },
  });

  const tenants = await prisma.tenant.findMany({ select: { id: true, slug: true, whiteLabelId: true } });
  const tById = new Map(tenants.map((t) => [t.id, t]));

  let waTotal = 0, waFilled = 0, waEmpty = 0;
  const recentEmpty = [];
  const recentFilled = [];

  for (const l of links) {
    const btns = Array.isArray(l.buttons) ? l.buttons : [];
    for (const b of btns) {
      if (!b || b.type !== 'WHATSAPP') continue;
      waTotal++;
      const filled = !!(b.waPhone && String(b.waPhone).trim());
      const t = tById.get(l.tenantId);
      const row = `${l.updatedAt.toISOString().slice(0,10)}  /i/${t?.slug}/${l.slug}  waPhone=${JSON.stringify(b.waPhone ?? null)}`;
      if (filled) { waFilled++; if (recentFilled.length < 10) recentFilled.push(row); }
      else { waEmpty++; if (recentEmpty.length < 15) recentEmpty.push(row); }
    }
  }

  console.log(`\n=== BOTONES WHATSAPP EN TODA LA PLATAFORMA ===`);
  console.log(`Total: ${waTotal}   con número: ${waFilled}   VACÍO: ${waEmpty}\n`);
  console.log(`--- Más recientes CON número (bien) ---`);
  recentFilled.forEach((r) => console.log('  ' + r));
  console.log(`\n--- Más recientes con número VACÍO (posible bug) ---`);
  recentEmpty.forEach((r) => console.log('  ' + r));

  await prisma.$disconnect();
})().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
