/**
 * Activa «varias cartas» en un negocio.
 *
 * Lo mismo que el interruptor de /admin/tenants/<id>, desde consola. Se usa
 * cuando hay que dejar a un negocio listo sin esperar a que alguien entre al
 * panel.
 *
 * Uso:  railway run node scripts/activar-varias-cartas.cjs <slug> <cartasExtra>
 *
 * `cartasExtra` es cuántas cartas ADEMÁS del menú principal, o `-1` para SIN
 * TOPE. El tope existe porque cada carta duplica el catálogo entero: un
 * negocio con 545 productos creando cartas sin freno multiplica la base sin
 * que nadie lo note.
 *
 * Idempotente: volver a correrlo con los mismos valores no cambia nada.
 */
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

(async () => {
  const [slug, extrasRaw] = process.argv.slice(2);
  if (!slug) throw new Error('falta el slug del negocio');
  const extras = Number(extrasRaw);
  if (!Number.isInteger(extras) || extras < -1 || extras > 20) {
    throw new Error('cartasExtra tiene que ser un entero entre -1 y 20 (-1 = sin tope)');
  }

  const t = await p.tenant.findFirst({
    where: { slug },
    select: {
      id: true,
      brandName: true,
      multiMenuEnabled: true,
      maxExtraMenus: true,
    },
  });
  if (!t) throw new Error(`no existe el negocio "${slug}"`);

  console.log(
    `antes:  ${t.brandName} · varias cartas=${t.multiMenuEnabled} · tope=${t.maxExtraMenus}`,
  );

  await p.tenant.update({
    where: { id: t.id },
    data: { multiMenuEnabled: true, maxExtraMenus: extras },
  });

  const cats = await p.category.count({ where: { tenantId: t.id, menuId: null } });
  const prods = await p.product.count({ where: { tenantId: t.id, menuId: null } });
  const cartas = await p.menu.count({ where: { tenantId: t.id } });

  console.log(
    `después: varias cartas=true · tope=${extras < 0 ? 'SIN TOPE' : extras}`,
  );
  console.log(
    `menú principal: ${cats} categorías · ${prods} productos · cartas extra creadas: ${cartas}`,
  );
  await p.$disconnect();
})().catch((e) => {
  console.error('ERR', e.message);
  process.exit(1);
});
