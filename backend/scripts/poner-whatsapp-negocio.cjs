/**
 * Corrige el WhatsApp de un negocio.
 *
 * Es el número al que le llegan los avisos que Clubify le manda AL NEGOCIO
 * (cobro pendiente, pedido nuevo, pago recibido). Varios quedaron con un
 * relleno tipo `+573000000000` del alta, y con eso los avisos se envían
 * "bien" pero no llegan a nadie: el fallo no se ve, solo se nota que el
 * negocio dice que nunca le avisan.
 *
 *   Ver:     railway run node scripts/poner-whatsapp-negocio.cjs <slug>
 *   Poner:   railway run node scripts/poner-whatsapp-negocio.cjs <slug> +573189399844
 *
 * Idempotente.
 */
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

/** Rellenos que hemos visto en producción y que no son un teléfono real. */
const RELLENOS = [/^\+?57?3?0{6,}$/, /^\+?1?2345/, /^\+?0+$/];

(async () => {
  const [slug, telefono] = process.argv.slice(2);
  if (!slug) throw new Error('uso: <slug> [telefono]');

  const t = await p.tenant.findFirst({
    where: { slug },
    select: { id: true, brandName: true, whatsappPhone: true, phone: true },
  });
  if (!t) throw new Error(`no existe el negocio "${slug}"`);

  const sospechoso = (n) => !!n && RELLENOS.some((r) => r.test(n.replace(/[\s()-]/g, '')));
  console.log(
    `${t.brandName}\n  whatsappPhone: ${t.whatsappPhone ?? '—'}${sospechoso(t.whatsappPhone) ? '   <-- parece de relleno' : ''}\n  phone:         ${t.phone ?? '—'}`,
  );

  if (!telefono) return p.$disconnect();

  if (!/^\+\d{8,15}$/.test(telefono)) {
    throw new Error('el teléfono va en formato internacional: +573189399844');
  }
  await p.tenant.update({
    where: { id: t.id },
    data: { whatsappPhone: telefono },
  });
  console.log(`\n  -> whatsappPhone actualizado a ${telefono}`);
  await p.$disconnect();
})().catch((e) => {
  console.error('ERR', e.message);
  process.exit(1);
});
