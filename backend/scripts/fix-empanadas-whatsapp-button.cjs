// ESCRITURA PUNTUAL (autorizada). Convierte el botón "Whatsapp para Ayuda" del
// infolink de empanadas-la-parada de type=EXTERNAL (roto) a un botón WhatsApp
// correcto con el número que estaba atascado en el mensaje.
//   0424-465-7556 (VE) → waPhone "+58 4244657556" → wa.me/584244657556
// Solo toca ESE botón (por _id); preserva todo lo demás.
//   railway run --service Postgres-Nq8w node scripts/fix-empanadas-whatsapp-button.cjs
const { PrismaClient } = require('@prisma/client');
const TARGET_ID = '58e642bd-50c2-4771-8567-42b8088d8db7';
(async () => {
  const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
  if (!url) { console.error('No DATABASE_URL'); process.exit(1); }
  const prisma = new PrismaClient({ datasources: { db: { url } } });

  const t = await prisma.tenant.findFirst({ where: { slug: 'empanadas-la-parada' }, select: { id: true } });
  if (!t) { console.error('tenant no encontrado'); process.exit(1); }
  const link = await prisma.infoLink.findFirst({
    where: { tenantId: t.id, slug: 'infolink' },
    select: { id: true, buttons: true },
  });
  if (!link) { console.error('infolink no encontrado'); process.exit(1); }

  const btns = Array.isArray(link.buttons) ? link.buttons : [];
  const idx = btns.findIndex((b) => b && b._id === TARGET_ID);
  if (idx < 0) { console.error('botón target no encontrado'); process.exit(1); }

  console.log('ANTES:', JSON.stringify({
    type: btns[idx].type, waPhone: btns[idx].waPhone, waMessage: btns[idx].waMessage, url: btns[idx].url,
  }));

  // Solo cambiamos type + waPhone + limpiamos waMessage (tenía el número).
  const next = btns.map((b, i) =>
    i === idx ? { ...b, type: 'WHATSAPP', waPhone: '+58 4244657556', waMessage: '' } : b,
  );
  await prisma.infoLink.update({ where: { id: link.id }, data: { buttons: next } });

  const after = next[idx];
  console.log('DESPUÉS:', JSON.stringify({ type: after.type, waPhone: after.waPhone, waMessage: after.waMessage }));
  console.log(`✅ Botón convertido a WhatsApp → wa.me/${String(after.waPhone).replace(/\D/g, '')}`);
  await prisma.$disconnect();
})().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
