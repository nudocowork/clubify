/**
 * Negocios con el diseño antiguo FLIPBOOK pero SIN libro: el menú redirige a
 * /book, que sale «La carta todavía se está preparando», aunque su carta
 * digital tenga productos. Encontrado en el barrido en navegador de los 114
 * negocios (2026-10-05): Café y Gracia. Se pasan a CLASSIC solo los que
 * cumplen las tres condiciones (FLIPBOOK + libro apagado + libro sin páginas).
 *
 *   railway run --service Postgres-Nq8w node scripts/arreglar-flipbook-sin-libro.cjs [--aplicar]
 */
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient({
  datasources: { db: { url: process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL } },
});
const APLICAR = process.argv.includes('--aplicar');

(async () => {
  const filas = await p.$queryRawUnsafe(`
    SELECT t.id, t."brandName", s.id AS sid
      FROM "Tenant" t JOIN "Storefront" s ON s."tenantId" = t.id
     WHERE s."menuLayout" = 'FLIPBOOK'
       AND COALESCE(s."bookMenuEnabled", false) = false
       AND t."deletedAt" IS NULL
       AND NOT EXISTS (
         SELECT 1 FROM "MenuBookSection" mb WHERE mb."tenantId" = t.id
       )`);
  if (!filas.length) {
    console.log('Nada que arreglar: ningún FLIPBOOK sin libro.');
    return p.$disconnect();
  }
  for (const f of filas) {
    console.log(`${APLICAR ? 'APLICO' : 'simulo'} ${f.brandName}: menuLayout FLIPBOOK → CLASSIC (libro apagado y sin páginas)`);
    if (APLICAR) {
      await p.$executeRawUnsafe(`UPDATE "Storefront" SET "menuLayout" = 'CLASSIC' WHERE id = $1 AND "menuLayout" = 'FLIPBOOK'`, f.sid);
    }
  }
  if (!APLICAR) console.log('(simulación: --aplicar para escribir)');
  await p.$disconnect();
})().catch(async (e) => {
  console.error('ERROR:', e.message);
  await p.$disconnect();
  process.exit(1);
});
