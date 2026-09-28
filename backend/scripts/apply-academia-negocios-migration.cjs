/**
 * Migración ADITIVA: `WhiteLabel.academiaNegociosUrl`.
 *
 * La academia que ve el DUEÑO DE UN NEGOCIO en su menú lateral, por marca.
 *
 * Hasta ahora ese enlace estaba escrito a mano en `AppShell.tsx` apuntando a
 * `academy.soyclubify.lat/cliente`, así que **13 negocios de Sellea** llegaban
 * a la academia de Clubify desde su propio panel (medido el 2026-09-28). Es el
 * mismo fallo que ya se arregló en el panel del AFILIADO con `academiaUrl`.
 *
 * SIEMBRA SOLO A CLUBIFY, con la URL que hoy está en el código. Así ningún
 * negocio de Clubify pierde su enlace al desplegar. A las demás marcas se les
 * deja en NULL a propósito: null significa «esta marca no tiene academia para
 * negocios» y la entrada no se muestra. Inventarles una sería mandarlas otra
 * vez a la de Clubify, que es justo el fallo que se está arreglando.
 *
 * Aditiva e idempotente: `ADD COLUMN IF NOT EXISTS` sobre una columna nullable,
 * y la siembra solo escribe si está vacía.
 *
 * Uso:  railway run node scripts/apply-academia-negocios-migration.cjs
 */
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient({
  datasources: {
    db: { url: process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL },
  },
});

/** El enlace que hoy está escrito a mano en el menú, para no perderlo. */
const ACADEMIA_DE_CLUBIFY = 'https://academy.soyclubify.lat/cliente';

(async () => {
  const yaEsta = await p.$queryRawUnsafe(`
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'WhiteLabel' AND column_name = 'academiaNegociosUrl'
  `);
  if (yaEsta.length) {
    console.log('· La columna "academiaNegociosUrl" ya existe.');
  } else {
    console.log('· Añadiendo WhiteLabel."academiaNegociosUrl" (texto, nullable)…');
    await p.$executeRawUnsafe(
      `ALTER TABLE "WhiteLabel" ADD COLUMN IF NOT EXISTS "academiaNegociosUrl" TEXT`,
    );
  }

  // Solo Clubify, y solo si está vacía: si alguien ya la configuró a mano, no
  // se le pisa.
  const r = await p.$executeRawUnsafe(
    `UPDATE "WhiteLabel"
        SET "academiaNegociosUrl" = $1
      WHERE slug = 'clubify' AND "academiaNegociosUrl" IS NULL`,
    ACADEMIA_DE_CLUBIFY,
  );
  console.log(
    r > 0
      ? `· Clubify sembrada con su academia de negocios.`
      : '· Clubify ya la tenía puesta (o no existe la marca). Sin cambios.',
  );

  const marcas = await p.$queryRawUnsafe(`
    SELECT slug, name, "academiaUrl", "academiaNegociosUrl"
    FROM "WhiteLabel" ORDER BY slug
  `);
  console.log('\nCómo queda cada marca:');
  for (const m of marcas) {
    console.log(
      `  ${m.slug.padEnd(12)}` +
        ` | afiliados: ${m.academiaUrl ? 'sí' : '—'}` +
        ` | negocios: ${m.academiaNegociosUrl ?? '— (no verán la entrada)'}`,
    );
  }

  // Cuántos negocios se quedan sin la entrada, para que no sorprenda.
  const afectados = await p.$queryRawUnsafe(`
    SELECT COALESCE(w.slug, '(sin marca)') AS marca, COUNT(*)::int AS negocios
    FROM "Tenant" t LEFT JOIN "WhiteLabel" w ON w.id = t."whiteLabelId"
    WHERE t.status IN ('ACTIVE', 'TRIAL')
      AND (w."academiaNegociosUrl" IS NULL AND w.id IS NOT NULL)
    GROUP BY 1 ORDER BY 2 DESC
  `);
  if (afectados.length) {
    console.log(
      '\nOJO — estos negocios DEJARÁN de ver la entrada de academia hasta que',
      '\nsu marca configure la suya. Antes veían la de Clubify, que no es suya:',
    );
    for (const a of afectados) {
      console.log(`  ${a.marca.padEnd(12)} | ${a.negocios} negocios`);
    }
  } else {
    console.log('\nNingún negocio se queda sin la entrada.');
  }

  await p.$disconnect();
})().catch(async (e) => {
  console.error('ERROR:', e.message);
  await p.$disconnect();
  process.exit(1);
});
