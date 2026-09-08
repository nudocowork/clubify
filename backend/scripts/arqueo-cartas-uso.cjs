/**
 * SOLO LECTURA: cuánto se usa hoy lo de varias cartas por sede.
 *
 * Decide el riesgo de cualquier cambio de arquitectura: si son 3 negocios, se
 * migra a mano; si son 40, hace falta plan.
 */
const { PrismaClient } = require('@prisma/client');
(async () => {
  const p = new PrismaClient();
  try {
    const habilitados = await p.tenant.count({ where: { multiMenuEnabled: true } });
    const conSedes = await p.tenant.count({ where: { locations: { some: {} } } });
    const totalMenus = await p.menu.count();
    const menusConSede = await p.menu.count({ where: { locationId: { not: null } } });
    const totalProductos = await p.product.count();
    const productosEnCarta = await p.product.count({ where: { menuId: { not: null } } });
    const copiasSync = await p.product.count({ where: { syncWithSource: true } });
    const copias = await p.product.count({ where: { sourceProductId: { not: null } } });
    const sedes = await p.location.count();

    console.log('CARTAS POR SEDE — uso real hoy');
    console.log(`  negocios con la funcion habilitada .... ${habilitados}`);
    console.log(`  negocios con al menos una sede ........ ${conSedes}`);
    console.log(`  sedes en total ........................ ${sedes}`);
    console.log(`  cartas creadas ........................ ${totalMenus} (${menusConSede} atadas a una sede)`);
    console.log(`  productos en total .................... ${totalProductos}`);
    console.log(`     en el menu principal ............... ${totalProductos - productosEnCarta}`);
    console.log(`     en una carta ....................... ${productosEnCarta}`);
    console.log(`  copias de otro producto ............... ${copias} (${copiasSync} siguen al original)`);

    const conCartas = await p.tenant.findMany({
      where: { menus: { some: {} } },
      select: {
        brandName: true,
        multiMenuEnabled: true,
        _count: { select: { menus: true, products: true, locations: true } },
      },
    });
    console.log(`\nnegocios con cartas creadas: ${conCartas.length}`);
    for (const t of conCartas) {
      console.log(
        `  ${(t.brandName ?? '').slice(0, 30).padEnd(32)} ` +
          `${t._count.menus} cartas · ${t._count.locations} sedes · ${t._count.products} productos` +
          `${t.multiMenuEnabled ? '' : '  (funcion APAGADA)'}`,
      );
    }
  } finally {
    await p.$disconnect();
  }
})();
