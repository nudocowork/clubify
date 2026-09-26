/**
 * Escribe el tope que el pase YA enseña en los cartones que no lo tienen.
 *
 * EL PROBLEMA. `Card.stampsRequired` es nullable, y cuando falta cada lector
 * se inventa una respuesta distinta: el pase de Apple y el de Google dicen
 * `?? 10`, el canje resta `?? 10`, el tope al sellar es `MAX_SAFE_INTEGER` y
 * `reglaDeEstado` se rinde — así que **el pase NUNCA llega a COMPLETED**.
 *
 * En producción (2026-09-26): «Descomunal - Cocina y SportBar» reparte desde
 * julio una tarjeta por «Desgranado de Pollo + Gaseosa» con 59 pases, 54
 * instalados en teléfonos y 64 sellos puestos. Sus clientes ven «8/10» y
 * **nadie puede reclamar el pollo**. Dos van por 8.
 *
 * POR QUÉ 10 Y NO OTRO NÚMERO. Porque 10 es lo que esos 54 clientes llevan
 * meses viendo en su móvil. Escribirlo **no cambia ni un píxel** de lo que ven:
 * lo único que cambia es que a partir de ahí el cartón se puede dar por lleno
 * y el premio se puede entregar. Cualquier otro número rompería una promesa ya
 * hecha — si el negocio quería 6, esas dos personas ya lo habrían ganado; si
 * quería 12, se les habría acortado.
 *
 * NO INVENTA NADA NUEVO: la puerta del panel ya rechaza crear cartones así
 * (`cards/tope-del-carton.ts`) y el Onboarding ya los rellena. Esto es solo
 * para las que entraron antes.
 *
 * IDEMPOTENTE: solo toca las que tienen el tope en NULL. Correrlo dos veces no
 * hace nada la segunda.
 *
 * Uso:
 *   cd backend
 *   railway run --service Postgres-Nq8w node scripts/poner-tope-a-cartones-sin-tope.cjs
 */
const { PrismaClient } = require('@prisma/client');
// `railway run` inyecta la `DATABASE_URL` INTERNA (`…railway.internal:5432`),
// que SOLO resuelve dentro de la red de Railway. Se prefiere la PÚBLICA.
const p = new PrismaClient({
  datasources: {
    db: { url: process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL },
  },
});

const TOPE = 10;

const sinTope = () =>
  p.$queryRawUnsafe(`
    SELECT c.id, c.name, c."rewardText", t."brandName" AS negocio,
           (SELECT COUNT(*)::int FROM "Pass" ps WHERE ps."cardId"=c.id) AS pases,
           (SELECT COALESCE(MAX(ps."stampsCount"),0)::int FROM "Pass" ps WHERE ps."cardId"=c.id) AS max_sellos
    FROM "Card" c JOIN "Tenant" t ON t.id=c."tenantId"
    WHERE c.type='STAMPS' AND c."stampsRequired" IS NULL
      AND c."convenioId" IS NULL AND c."clubPlanId" IS NULL
    ORDER BY 5 DESC`);

(async () => {
  const antes = await sinTope();
  if (!antes.length) {
    console.log('No hay cartones sin tope. Nada que hacer.');
    return p.$disconnect();
  }

  console.log('CARTONES SIN TOPE:');
  for (const c of antes) {
    console.log(
      `  · ${c.negocio} — «${c.name}» · premio: ${c.rewardText || '(sin premio escrito)'}`,
    );
    console.log(`    ${c.pases} pases · el que más lleva: ${c.max_sellos} sellos`);
  }

  // Si alguien ya pasó de 10, escribir 10 le daría el cartón por lleno de
  // golpe. No es un error, pero hay que verlo antes y no después.
  const pasados = antes.filter((c) => c.max_sellos > TOPE);
  if (pasados.length) {
    console.log(
      `\n⚠ ${pasados.length} tarjeta(s) tienen a alguien POR ENCIMA de ${TOPE} sellos.`,
    );
    console.log('  Al poner el tope, esos pases quedan completos de inmediato.');
  }

  const cambiadas = await p.$executeRawUnsafe(
    // `Card` NO tiene `updatedAt` — comprobado en el esquema, no supuesto.
    `UPDATE "Card" SET "stampsRequired" = $1
     WHERE type='STAMPS' AND "stampsRequired" IS NULL
       AND "convenioId" IS NULL AND "clubPlanId" IS NULL`,
    TOPE,
  );
  console.log(`\nTarjetas actualizadas: ${cambiadas}`);

  const despues = await sinTope();
  console.log(`Quedan sin tope: ${despues.length}`);

  // Nada más puede haber cambiado: ni un sello, ni un pase.
  const [cuadre] = await p.$queryRawUnsafe(`
    SELECT COUNT(*)::int AS tarjetas_stamps,
           (SELECT COUNT(*)::int FROM "Pass") AS pases,
           (SELECT COUNT(*)::int FROM "Stamp") AS sellos
    FROM "Card" WHERE type='STAMPS'`);
  console.log('CUADRE (no debe haber cambiado nada de esto):', cuadre);

  await p.$disconnect();
})().catch(async (e) => {
  console.error('ERROR:', e.message);
  await p.$disconnect();
  process.exit(1);
});
