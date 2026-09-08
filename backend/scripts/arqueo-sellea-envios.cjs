/**
 * SOLO LECTURA: ¿los negocios de Sellea reciben los mensajes desde la línea de
 * Sellea, o desde la de Clubify?
 *
 * La cascada de credenciales es: propias del negocio → subcuenta de SU marca.
 * Si la marca no tiene subcuenta, sus negocios acaban saliendo por la línea de
 * la plataforma, y el cliente de Sellea ve un remitente que no es el suyo.
 */
const { PrismaClient } = require('@prisma/client');

(async () => {
  const p = new PrismaClient();
  try {
    const marcas = await p.whiteLabel.findMany({
      select: {
        id: true,
        name: true,
        slug: true,
        growBusinessLocationId: true,
        growBusinessApiKey: true,
        growBusinessSwitchNumber: true,
      },
      orderBy: { name: 'asc' },
    });
    console.log(`marcas: ${marcas.length}\n`);
    for (const m of marcas) {
      const propias = !!(m.growBusinessLocationId && m.growBusinessApiKey);
      const negocios = await p.tenant.findMany({
        where: { whiteLabelId: m.id, status: 'ACTIVE' },
        select: { growBusinessLocationId: true, growBusinessApiKey: true },
      });
      const conPropias = negocios.filter(
        (t) => t.growBusinessLocationId && t.growBusinessApiKey,
      ).length;
      console.log(
        `${m.name} (${m.slug})\n` +
          `  subcuenta de la marca: ${propias ? 'SÍ · switch ' + (m.growBusinessSwitchNumber ?? '-') : 'NO'}\n` +
          `  negocios activos: ${negocios.length} · con credenciales propias: ${conPropias}` +
          `\n  → salen por: ${
            conPropias === negocios.length && negocios.length
              ? 'su propia línea cada uno'
              : propias
                ? `${negocios.length - conPropias} por la línea de la MARCA`
                : `${negocios.length - conPropias} SIN línea propia ni de marca`
          }`,
      );
    }
  } finally {
    await p.$disconnect();
  }
})();
