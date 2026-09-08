/**
 * SOLO LECTURA: de los negocios con VARIAS sedes, cuántos usan hoy un solo
 * menú para todas.
 *
 * Es el caso que la propuesta no nombraba: multisede, pero con la misma carta
 * en todas partes. Si resulta ser la inmensa mayoría, ese tiene que ser el
 * camino por defecto y no una excepción.
 */
const { PrismaClient } = require('@prisma/client');
(async () => {
  const p = new PrismaClient();
  try {
    const negocios = await p.tenant.findMany({
      where: { locations: { some: {} } },
      select: {
        brandName: true,
        multiMenuEnabled: true,
        _count: { select: { locations: true, menus: true, products: true } },
      },
    });

    const varias = negocios.filter((t) => t._count.locations > 1);
    const conCarta = varias.filter((t) => t._count.menus > 0);

    console.log(`negocios con al menos una sede ........ ${negocios.length}`);
    console.log(`negocios con MÁS DE UNA sede .......... ${varias.length}`);
    console.log(`   de esos, con carta propia por sede . ${conCarta.length}`);
    console.log(`   de esos, con un solo menú para todas ${varias.length - conCarta.length}`);

    const conProductos = varias.filter((t) => t._count.products > 0);
    console.log(`\ncon más de una sede Y catálogo cargado: ${conProductos.length}`);
    for (const t of conProductos.sort((a, b) => b._count.locations - a._count.locations)) {
      console.log(
        `  ${(t.brandName ?? '').slice(0, 30).padEnd(32)} ` +
          `${String(t._count.locations).padStart(2)} sedes · ` +
          `${String(t._count.products).padStart(4)} productos · ` +
          `${t._count.menus} cartas`,
      );
    }
  } finally {
    await p.$disconnect();
  }
})();
