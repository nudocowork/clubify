/**
 * Habilita «una carta por sede» a un negocio y le crea una carta por cada sede.
 *
 * ⚠️ ANTES DE USARLO: CASI SEGURO NO ES LO QUE HACE FALTA
 * -------------------------------------------------------
 * Hay DOS formas de que cada sede enseñe cosas distintas, y esta es la MENOS
 * común:
 *
 *   1. `Product.locationMode = SELECCIONADAS` + `ProductLocation` — el producto
 *      vive en el menú principal y se enseña solo en las sedes elegidas. **Es
 *      lo que usa el Onboarding.** No necesita cartas ni esta función.
 *   2. Una carta por sede (`multiMenuEnabled`) — catálogos SEPARADOS. Solo si
 *      la sede B vende cosas que la A ni tiene.
 *
 * El 2026-09-10 corrí esto contra Slata creyendo que le faltaban cartas. Lo que
 * tenía era el mecanismo 1 bien puesto desde el Onboarding: un producto solo en
 * Cabecera, otro en las dos. Las cartas que creé duplicaron TODO con
 * `locationMode = TODAS` y sin filas de `ProductLocation`, así que las dos sedes
 * pasaron a enseñar lo mismo — rompí el reparto que ya funcionaba. Hubo que
 * borrarlas.
 *
 * **Comprobar primero si el negocio ya reparte por `ProductLocation`.** Si sí,
 * no toques esto.
 *
 * Las cartas se crean por la API REAL (`POST /api/catalog/menus`) y no a mano
 * con Prisma: duplicar una carta copia categorías respetando el árbol
 * padre/hijo, productos, variantes y extras. Reescribir esa copia aquí es
 * exactamente cómo se acaba con dos versiones que divergen.
 *
 *   railway run node scripts/habilitar-cartas-por-sede.cjs <slug>            (ensayo)
 *   railway run node scripts/habilitar-cartas-por-sede.cjs <slug> --aplicar
 *
 * IDEMPOTENTE: una sede que ya tiene carta no recibe otra.
 */
const { PrismaClient } = require('@prisma/client');
const jwt = require('jsonwebtoken');

const SLUG = process.argv[2];
const APLICAR = process.argv.includes('--aplicar');
const API = process.env.API_URL || 'https://api.soyclubify.com';

if (!SLUG || SLUG.startsWith('--')) {
  console.error('Uso: node scripts/habilitar-cartas-por-sede.cjs <slug-del-negocio> [--aplicar]');
  process.exit(1);
}

(async () => {
  const p = new PrismaClient();
  try {
    const t = await p.tenant.findFirst({
      where: { slug: SLUG },
      select: {
        id: true, slug: true, brandName: true, whiteLabelId: true,
        multiMenuEnabled: true, maxExtraMenus: true,
      },
    });
    if (!t) throw new Error(`no existe el negocio "${SLUG}"`);

    const sedes = await p.location.findMany({
      where: { tenantId: t.id, isActive: true },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
    const cartas = await p.menu.findMany({
      where: { tenantId: t.id },
      select: { id: true, name: true, locationId: true },
    });
    const conCarta = new Set(cartas.map((c) => c.locationId).filter(Boolean));
    const faltan = sedes.filter((s) => !conCarta.has(s.id));

    console.log(`Negocio: ${t.brandName} (${t.slug})`);
    console.log(`  multiMenuEnabled=${t.multiMenuEnabled}  maxExtraMenus=${t.maxExtraMenus}`);
    console.log(`  sedes activas: ${sedes.length} · cartas extra: ${cartas.length}`);
    for (const s of sedes) {
      console.log(`     ${s.name.padEnd(24)} ${conCarta.has(s.id) ? 'ya tiene carta' : 'SIN CARTA'}`);
    }

    // El tope tiene que dar para una carta por sede. Si ya es mayor, no se baja:
    // el admin pudo subirlo a mano y bajarlo aquí sería pisarle la decisión.
    const topeNecesario = Math.max(sedes.length, t.maxExtraMenus ?? 1);

    if (!faltan.length && t.multiMenuEnabled) {
      console.log('\nNada que hacer: ya está habilitado y cada sede tiene su carta.');
      return;
    }

    console.log(`\nSe va a hacer:`);
    if (!t.multiMenuEnabled) console.log('   · encender multiMenuEnabled');
    if (topeNecesario !== t.maxExtraMenus) console.log(`   · subir maxExtraMenus a ${topeNecesario}`);
    for (const s of faltan) console.log(`   · crear carta "${s.name}" duplicando el menú principal`);

    if (!APLICAR) {
      console.log('\nENSAYO. Nada cambiado. Repite con --aplicar.');
      return;
    }

    await p.tenant.update({
      where: { id: t.id },
      data: { multiMenuEnabled: true, maxExtraMenus: topeNecesario },
    });
    console.log('\nok · función habilitada');

    if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET no esta en el entorno');
    // Token de un admin de LA MARCA del negocio: el endpoint aísla por marca y
    // un admin de otra devolvería «no encontrado».
    const admin = await p.user.findFirst({
      where: { role: 'SUPER_ADMIN', isActive: true, whiteLabelId: t.whiteLabelId ?? null },
      select: { id: true, email: true, role: true, tenantId: true, whiteLabelId: true },
    });
    if (!admin) throw new Error('no hay SUPER_ADMIN activo para la marca de este negocio');
    const token = jwt.sign(
      {
        sub: admin.id, email: admin.email, role: admin.role,
        tenantId: admin.tenantId, whiteLabelId: admin.whiteLabelId,
      },
      process.env.JWT_SECRET,
      { expiresIn: '30m' },
    );

    for (const s of faltan) {
      const r = await fetch(
        `${API}/api/catalog/menus?tenantId=${encodeURIComponent(t.id)}`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          // `duplicar` sin `duplicarDe` copia el MENÚ PRINCIPAL — que es donde
          // vive todo el catálogo de un negocio que nunca usó esta función.
          body: JSON.stringify({ name: s.name, locationId: s.id, duplicar: true }),
        },
      ).then((res) => res.json().then((j) => ({ status: res.status, j })))
       .catch((e) => ({ status: 0, j: { error: e.message } }));

      if (r.status >= 200 && r.status < 300) {
        console.log(`ok · carta "${s.name}" creada (${r.j?.id ?? '?'})`);
      } else {
        console.log(`FALLO · carta "${s.name}" → ${r.status} ${JSON.stringify(r.j).slice(0, 200)}`);
      }
    }
  } finally {
    await p.$disconnect();
  }
})().catch((e) => {
  console.error('ERR', e.message);
  process.exit(1);
});
