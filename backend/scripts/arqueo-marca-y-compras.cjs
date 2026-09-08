/**
 * SOLO LECTURA: la marca de alguien y los teléfonos con los que compra.
 *
 * Los avisos de «recibimos tu pago, activa tu cuenta» no salen de la ficha de
 * usuario: salen del TELÉFONO QUE VIENE EN LA COMPRA de Hotmart. Por eso a
 * alguien sin teléfono en su ficha le pueden estar llegando igual.
 */
const { PrismaClient } = require('@prisma/client');

const AGUJA = process.argv[2] || 'medicenache';

(async () => {
  const p = new PrismaClient();
  try {
    const marcas = await p.whiteLabel.findMany({
      where: {
        OR: [
          { name: { contains: AGUJA, mode: 'insensitive' } },
          { slug: { contains: AGUJA, mode: 'insensitive' } },
        ],
      },
      select: {
        id: true,
        name: true,
        slug: true,
        growBusinessLocationId: true,
        growBusinessApiKey: true,
        paymentGateway: true,
      },
    });
    console.log(`marcas que coinciden con «${AGUJA}»: ${marcas.length}`);
    for (const m of marcas) {
      const creds = m.growBusinessLocationId && m.growBusinessApiKey;
      console.log(
        `  ${m.name} (${m.slug}) · pasarela ${m.paymentGateway ?? '—'} · ` +
          `subcuenta propia: ${creds ? 'SÍ' : 'NO — sus mensajes salen por otra línea'}`,
      );
      const negocios = await p.tenant.count({ where: { whiteLabelId: m.id } });
      console.log(`     negocios de esta marca: ${negocios}`);
    }

    // Los teléfonos con los que ha comprado: de ahí salen los avisos de pago.
    const compras = await p.hotmartWebhookEvent.findMany({
      where: { processedAt: { gte: new Date(Date.now() - 120 * 86400000) } },
      select: { eventType: true, payload: true, processedAt: true },
      orderBy: { processedAt: 'desc' },
      take: 400,
    });
    const suyas = [];
    for (const c of compras) {
      const b = c.payload?.data?.buyer;
      const correo = (b?.email ?? '').toLowerCase();
      if (!correo.includes(AGUJA.toLowerCase())) continue;
      const tel =
        b?.checkout_phone ??
        (b?.phone_local_code && b?.phone_number
          ? `+${b.phone_local_code}${b.phone_number}`
          : null);
      suyas.push(
        `${c.processedAt.toISOString().slice(0, 10)} · ${c.eventType} · ` +
          `${b?.name ?? '—'} · ${correo} · tel ${tel ?? 'sin teléfono en la compra'}`,
      );
    }
    console.log(`\ncompras con ese correo (120 días): ${suyas.length}`);
    for (const s of suyas.slice(0, 10)) console.log(`  ${s}`);
  } finally {
    await p.$disconnect();
  }
})();
