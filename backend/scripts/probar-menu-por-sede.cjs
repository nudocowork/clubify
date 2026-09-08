/**
 * PRUEBA DE EXTREMO A EXTREMO del menú por sede, contra producción.
 *
 * Que la tabla vacía no cambie nada ya está comprobado. Esto comprueba lo
 * contrario: que CON un dato, el menú de esa sede cambia y el de las demás no.
 *
 * Escribe una fila, mira el menú por HTTP y **borra la fila en un `finally`**.
 * Si algo revienta en medio, la fila se borra igual: no puede quedarse un
 * precio de prueba en el menú de un negocio.
 *
 * Uso:  railway run node scripts/probar-menu-por-sede.cjs [slug]
 */
const { PrismaClient } = require('@prisma/client');

const SLUG = process.argv[2] || 'demo-clubify';
const API = process.env.API_URL || 'https://api.soyclubify.com';

const precioDe = (menu, id) => {
  for (const sec of menu.categories ?? menu ?? []) {
    for (const p of sec.products ?? []) if (p.id === id) return p.basePrice;
    for (const sub of sec.subsections ?? []) {
      for (const p of sub.products ?? []) if (p.id === id) return p.basePrice;
    }
  }
  return null;
};
const estaEn = (menu, id) => precioDe(menu, id) !== null;

async function menu(slug, sede) {
  // El menú se cachea 180 s en el borde (`s-maxage=180`). Sin romper la caché
  // esta prueba se mira a sí misma: escribe una fila y lee la respuesta de
  // hace tres minutos. La primera versión daba «no funciona nada» por esto.
  const cb = `_=${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const url = `${API}/api/public/m/${slug}/menu?${sede ? `sede=${sede}&` : ''}${cb}`;
  const r = await fetch(url, { cache: 'no-store' });
  if (!r.ok) throw new Error(`${url} → ${r.status}`);
  const j = await r.json();
  return j.categories ?? j;
}

(async () => {
  const p = new PrismaClient();
  let filaId = null;
  try {
    const t = await p.tenant.findUnique({
      where: { slug: SLUG },
      select: { id: true, brandName: true },
    });
    if (!t) throw new Error(`no existe el negocio «${SLUG}»`);

    const sedes = await p.location.findMany({
      where: { tenantId: t.id, isActive: true },
      select: { id: true, name: true },
      take: 2,
    });
    if (sedes.length < 2) throw new Error('hacen falta 2 sedes activas');
    const [sedeA, sedeB] = sedes;

    const producto = await p.product.findFirst({
      where: { tenantId: t.id, isAvailable: true, categoryId: { not: null } },
      select: { id: true, name: true, basePrice: true, locationMode: true },
    });
    if (!producto) throw new Error('no hay productos');

    console.log(`${t.brandName}`);
    console.log(`  producto ...... ${producto.name}  ($${producto.basePrice})`);
    console.log(`  sede A ........ ${sedeA.name}`);
    console.log(`  sede B ........ ${sedeB.name}\n`);

    const precioBase = Number(producto.basePrice);
    const precioPrueba = precioBase + 7;

    // ── 1. Precio propio en la sede A ─────────────────────────────────
    const fila = await p.productLocation.create({
      data: {
        productId: producto.id,
        locationId: sedeA.id,
        selected: true,
        price: precioPrueba,
      },
      select: { id: true },
    });
    filaId = fila.id;

    const conPrecio = {
      A: precioDe(await menu(SLUG, sedeA.id), producto.id),
      B: precioDe(await menu(SLUG, sedeB.id), producto.id),
      general: precioDe(await menu(SLUG), producto.id),
    };
    console.log('PRECIO PROPIO EN LA SEDE A');
    console.log(`  sede A .......... $${conPrecio.A}  ${conPrecio.A === precioPrueba ? '✓' : '✗ debería ser $' + precioPrueba}`);
    console.log(`  sede B .......... $${conPrecio.B}  ${conPrecio.B === precioBase ? '✓ no le afecta' : '✗ le afectó'}`);
    console.log(`  enlace general .. $${conPrecio.general}  ${conPrecio.general === precioBase ? '✓' : '✗'}`);

    // ── 2. Agotado solo en la sede A ──────────────────────────────────
    await p.productLocation.update({
      where: { id: filaId },
      data: { price: null, isAvailable: false },
    });
    const agotado = {
      A: estaEn(await menu(SLUG, sedeA.id), producto.id),
      B: estaEn(await menu(SLUG, sedeB.id), producto.id),
    };
    console.log('\nAGOTADO SOLO EN LA SEDE A');
    console.log(`  sede A .......... ${agotado.A ? '✗ sigue saliendo' : '✓ no sale'}`);
    console.log(`  sede B .......... ${agotado.B ? '✓ sigue saliendo' : '✗ desapareció'}`);

    // ── 3. Solo en las sedes marcadas ─────────────────────────────────
    await p.productLocation.update({
      where: { id: filaId },
      data: { isAvailable: null, selected: true },
    });
    await p.product.update({
      where: { id: producto.id },
      data: { locationMode: 'SELECCIONADAS' },
    });
    const marcadas = {
      A: estaEn(await menu(SLUG, sedeA.id), producto.id),
      B: estaEn(await menu(SLUG, sedeB.id), producto.id),
      general: estaEn(await menu(SLUG), producto.id),
    };
    console.log('\nSOLO EN LAS SEDES MARCADAS (solo la A)');
    console.log(`  sede A .......... ${marcadas.A ? '✓ sale' : '✗ no sale'}`);
    console.log(`  sede B .......... ${marcadas.B ? '✗ sale y no debería' : '✓ no sale'}`);
    console.log(`  enlace general .. ${marcadas.general ? '✓ sale' : '✗ no sale'}`);

    const bien =
      conPrecio.A === precioPrueba &&
      conPrecio.B === precioBase &&
      conPrecio.general === precioBase &&
      !agotado.A &&
      agotado.B &&
      marcadas.A &&
      !marcadas.B &&
      marcadas.general;
    console.log(`\n${bien ? '✓ TODO CORRECTO' : '✗ HAY ALGO MAL — revisar arriba'}`);
  } finally {
    // Pase lo que pase: el negocio queda como estaba.
    if (filaId) {
      await p.productLocation.delete({ where: { id: filaId } }).catch(() => null);
    }
    const t = await p.tenant
      .findUnique({ where: { slug: SLUG }, select: { id: true } })
      .catch(() => null);
    if (t) {
      const n = await p.product.updateMany({
        where: { tenantId: t.id, locationMode: { not: 'TODAS' } },
        data: { locationMode: 'TODAS' },
      });
      const quedan = await p.productLocation.count({
        where: { product: { tenantId: t.id } },
      });
      console.log(`\nlimpieza: ${n.count} producto(s) devuelto(s) a TODAS · filas que quedan: ${quedan}`);
    }
    await p.$disconnect();
  }
})();
