// SOLO LECTURA. Busca botones WhatsApp ROTOS por el bug del campo aplastado:
// type=WHATSAPP con waPhone que es solo prefijo (sin número), O type=EXTERNAL con
// waPhone/waMessage residuales (número quedó en el mensaje). Reporta el alcance.
//   railway run --service Postgres-Nq8w node scripts/scan-broken-whatsapp-buttons.cjs
const { PrismaClient } = require('@prisma/client');
(async () => {
  const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
  if (!url) { console.error('No DATABASE_URL'); process.exit(1); }
  const prisma = new PrismaClient({ datasources: { db: { url } } });

  const links = await prisma.infoLink.findMany({
    select: { id: true, slug: true, buttons: true, tenantId: true },
  });
  const tenants = await prisma.tenant.findMany({ select: { id: true, slug: true, whiteLabelId: true } });
  const wls = await prisma.whiteLabel.findMany({ select: { id: true, name: true } });
  const tById = new Map(tenants.map((t) => [t.id, t]));
  const wlById = new Map(wls.map((w) => [w.id, w.name]));

  const digitsAfterDial = (wp) => String(wp || '').replace(/\D/g, '');
  const broken = [];

  for (const l of links) {
    const btns = Array.isArray(l.buttons) ? l.buttons : [];
    for (const b of btns) {
      if (!b || typeof b !== 'object') continue;
      const wp = String(b.waPhone || '');
      const digits = digitsAfterDial(wp);
      // Roto = tiene waPhone/waMessage de WhatsApp pero waPhone no tiene número
      // usable (<=4 dígitos = solo prefijo país), y hay un waMessage que parece número.
      const looksDialOnly = wp.trim() !== '' && digits.length <= 4;
      const msgLooksPhone = /^\+?\d[\d\s-]{5,}$/.test(String(b.waMessage || '').trim());
      const isWaButton = b.type === 'WHATSAPP' || wp.trim() !== '' || b.waMessage;
      if (isWaButton && (looksDialOnly || (b.type === 'EXTERNAL' && msgLooksPhone && looksDialOnly))) {
        const t = tById.get(l.tenantId);
        broken.push({
          marca: wlById.get(t?.whiteLabelId) || '(sin marca)',
          link: `/i/${t?.slug}/${l.slug}`,
          _id: b._id,
          type: b.type,
          waPhone: b.waPhone,
          waMessage: b.waMessage,
        });
      }
    }
  }

  console.log(`\n=== BOTONES WHATSAPP POSIBLEMENTE ROTOS (número atascado): ${broken.length} ===\n`);
  broken.forEach((r) => console.log(`  [${r.marca}] ${r.link}  type=${r.type}  waPhone=${JSON.stringify(r.waPhone)}  waMessage=${JSON.stringify(r.waMessage)}  _id=${r._id}`));
  if (broken.length === 0) console.log('  (ninguno más — solo era el de Empanadas, ya arreglado)');
  await prisma.$disconnect();
})().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
