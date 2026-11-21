/**
 * Sustituye el menú digital de un negocio por una copia del de otro.
 * Hecho para pasar el menú de Nudo Cowork a la cuenta DEMO CLUBIFY (2026-11-21).
 *
 * Copia el MENÚ PRINCIPAL (`menuId = null`): categorías con su árbol,
 * productos, variantes, extras y sus traducciones ya pagadas (sin ellas la
 * demo volvería a llamar a Claude por cada texto). También el diseño de la
 * página del menú (layout, portadas, colores, botón volver, Recomendados).
 *
 * NO copia: las cartas extra (`Menu`) —en Nudo son una por oficina/sala—,
 * filas por sede, la tarjeta del popup (es una Card del otro negocio: se queda
 * la del destino), el dominio propio ni el menú libro.
 *
 * Las imágenes se reutilizan por URL (no se duplican en R2): si el origen
 * borra una foto, la copia también la pierde.
 *
 * Antes de borrar guarda el menú actual del destino en un JSON (respaldo).
 *
 * Uso (desde backend/):
 *   railway run ... node scripts/copiar-menu-entre-negocios.cjs <slugOrigen> <slugDestino>                                   ← solo mira
 *   railway run ... node scripts/copiar-menu-entre-negocios.cjs <slugOrigen> <slugDestino> --respaldo=ruta.json --aplicar   ← escribe
 */
const { PrismaClient, Prisma } = require('@prisma/client');
const { randomUUID } = require('crypto');
const fs = require('fs');

const args = process.argv.slice(2);
const APLICAR = args.includes('--aplicar');
const [ORIGEN, DESTINO] = args.filter((a) => !a.startsWith('--'));
const RESPALDO = (args.find((a) => a.startsWith('--respaldo=')) || '').slice(11) || null;

const CAMPOS_DISENO = [
  'theme', 'description', 'heroImageUrl', 'menuLayout', 'popupEnabled', 'popupImageUrl', 'popupDelaySeconds',
  'pageBackgroundColor', 'pageBackgroundType', 'pageBackgroundGradient', 'pageBackgroundImageUrl',
  'logoBgColor', 'titleColor', 'descriptionColor', 'backButtonConfig', 'recommendedTagline',
  'recommendedCoverConfig', 'digitalMenuEnabled', 'whatsappButtonEnabled', 'instagramButtonEnabled',
];
const CAMPOS_JSON_NULABLES = ['backButtonConfig', 'recommendedCoverConfig'];

(async () => {
  if (!ORIGEN || !DESTINO || ORIGEN === DESTINO) throw new Error('Uso: <slugOrigen> <slugDestino>');
  if (APLICAR && !RESPALDO) throw new Error('Con --aplicar hace falta --respaldo=ruta.json');
  const p = new PrismaClient();
  const [o, d] = await Promise.all(
    [ORIGEN, DESTINO].map((slug) => p.tenant.findUnique({ where: { slug }, select: { id: true, brandName: true } })),
  );
  if (!o || !d) throw new Error(`No encontré ${!o ? ORIGEN : DESTINO}`);

  const leer = (tenantId) =>
    Promise.all([
      p.category.findMany({ where: { tenantId, menuId: null }, orderBy: { position: 'asc' } }),
      p.product.findMany({
        where: { tenantId, menuId: null },
        include: { variants: true, extras: true, productLocations: true },
        orderBy: { position: 'asc' },
      }),
    ]);
  const [cats, prods] = await leer(o.id);
  const [dCats, dProds] = await leer(d.id);
  const dMenus = await p.menu.count({ where: { tenantId: d.id } });
  const sfO = await p.storefront.findUnique({ where: { tenantId: o.id } });
  const sfD = await p.storefront.findUnique({ where: { tenantId: d.id } });
  if (!sfO || !sfD) throw new Error('Falta el storefront de alguno de los dos');

  // Mapas viejo → nuevo. Ids generados aquí para poder crear en lote: la base
  // va por el proxy público (~140 ms por consulta) y fila a fila no cabría en
  // el tiempo de una transacción.
  const catId = new Map(cats.map((c) => [c.id, randomUUID()]));
  const prodId = new Map(prods.map((x) => [x.id, randomUUID()]));
  const varId = new Map();
  const extId = new Map();
  prods.forEach((x) => {
    x.variants.forEach((v) => varId.set(v.id, randomUUID()));
    x.extras.forEach((e) => extId.set(e.id, randomUUID()));
  });
  const mapa = { category: catId, product: prodId, variant: varId, extra: extId };

  const trads = await p.menuTranslation.findMany({ where: { tenantId: o.id, entityType: { in: Object.keys(mapa) } } });
  const tradsCopia = trads.filter((t) => mapa[t.entityType].has(t.entityId));
  const nVar = varId.size;
  const nExt = extId.size;

  console.log(`${APLICAR ? 'APLICANDO' : 'SOLO MIRA'} · ${o.brandName} → ${d.brandName}`);
  console.log(`  se copian: ${cats.length} categorías, ${prods.length} productos, ${nVar} variantes, ${nExt} extras, ${tradsCopia.length} traducciones`);
  console.log(`  se borran del destino: ${dCats.length} categorías, ${dProds.length} productos (menú principal)${dMenus ? ` · tiene ${dMenus} carta(s) extra que NO se tocan` : ''}`);
  console.log(`  diseño que cambia: ${CAMPOS_DISENO.filter((k) => JSON.stringify(sfO[k]) !== JSON.stringify(sfD[k])).join(', ') || '(igual)'}`);
  if (prods.some((x) => x.productLocations.length)) console.log('  aviso: el origen tiene precios por sede; no se copian');

  if (!APLICAR) {
    console.log('\nNada escrito. Repetir con --respaldo=… --aplicar.');
    await p.$disconnect();
    return;
  }

  const dTrads = await p.menuTranslation.findMany({ where: { tenantId: d.id, entityType: { in: Object.keys(mapa) } } });
  fs.writeFileSync(
    RESPALDO,
    JSON.stringify({ tenantId: d.id, fecha: new Date(), storefront: sfD, categorias: dCats, productos: dProds, traducciones: dTrads }, null, 1),
  );
  console.log(`  respaldo del destino → ${RESPALDO}`);

  // Padres antes que hijos: el árbol se crea por niveles.
  const porId = new Map(cats.map((k) => [k.id, k]));
  const nivel = (c) => {
    let n = 0;
    let cur = c;
    while (cur.parentId && porId.has(cur.parentId)) { n++; cur = porId.get(cur.parentId); }
    return n;
  };
  const niveles = [];
  cats.forEach((c) => { const n = nivel(c); (niveles[n] = niveles[n] || []).push(c); });

  const diseno = {};
  CAMPOS_DISENO.forEach((k) => { diseno[k] = sfO[k]; });
  // Un Json? nulo se escribe como DbNull: Prisma no acepta `null` crudo ahí.
  CAMPOS_JSON_NULABLES.forEach((k) => { if (diseno[k] === null) diseno[k] = Prisma.DbNull; });

  await p.$transaction(
    async (tx) => {
      await tx.menuTranslation.deleteMany({ where: { tenantId: d.id, entityType: { in: Object.keys(mapa) } } });
      await tx.product.deleteMany({ where: { tenantId: d.id, menuId: null } });
      await tx.category.deleteMany({ where: { tenantId: d.id, menuId: null } });
      for (const grupo of niveles) {
        await tx.category.createMany({
          data: grupo.map(({ id, tenantId, menuId, parentId, createdAt, ...resto }) => ({
            ...resto,
            id: catId.get(id),
            tenantId: d.id,
            parentId: parentId ? catId.get(parentId) ?? null : null,
          })),
        });
      }
      await tx.product.createMany({
        data: prods.map(({ id, tenantId, menuId, categoryId, sourceProductId, syncWithSource, createdAt, variants, extras, productLocations, ...resto }) => ({
          ...resto,
          id: prodId.get(id),
          tenantId: d.id,
          categoryId: categoryId ? catId.get(categoryId) ?? null : null,
          timesOrdered: 0,
        })),
      });
      const vs = prods.flatMap((x) => x.variants.map(({ id, productId, ...r }) => ({ ...r, id: varId.get(id), productId: prodId.get(productId) })));
      const es = prods.flatMap((x) => x.extras.map(({ id, productId, ...r }) => ({ ...r, id: extId.get(id), productId: prodId.get(productId) })));
      if (vs.length) await tx.productVariant.createMany({ data: vs });
      if (es.length) await tx.productExtra.createMany({ data: es });
      if (tradsCopia.length) {
        await tx.menuTranslation.createMany({
          data: tradsCopia.map(({ id, tenantId, entityId, updatedAt, createdAt, ...r }) => ({
            ...r,
            tenantId: d.id,
            entityId: mapa[r.entityType].get(entityId),
          })),
        });
      }
      await tx.storefront.update({ where: { tenantId: d.id }, data: diseno });
    },
    { timeout: 120000, maxWait: 20000 },
  );

  const [c2, p2] = await leer(d.id);
  console.log(`\nListo: ${d.brandName} quedó con ${c2.length} categorías y ${p2.length} productos.`);
  await p.$disconnect();
})().catch((e) => {
  console.error('Falló:', e.message);
  process.exit(1);
});
