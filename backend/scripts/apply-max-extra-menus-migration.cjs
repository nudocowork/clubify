/**
 * Migración ADITIVA: `Tenant.maxExtraMenus` — cuántas cartas EXTRA puede crear
 * un negocio, además de su menú principal.
 *
 * El límite lo pone el admin: cada carta es un catálogo entero duplicado.
 * Default 1 = el caso normal (una segunda sede). Nadie cambia al migrar.
 *
 * Uso: railway run node scripts/apply-max-extra-menus-migration.cjs --aplicar
 */
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
const APLICAR = process.argv.includes('--aplicar');

(async () => {
  const [{ n }] = await p.$queryRawUnsafe(`
    SELECT COUNT(*)::int AS n FROM information_schema.columns
     WHERE table_name = 'Tenant' AND column_name = 'maxExtraMenus'`);
  if (n) { console.log('La columna ya existe. Nada que hacer.'); return p.$disconnect(); }
  if (!APLICAR) {
    console.log('Falta Tenant.maxExtraMenus.\n(en seco — --aplicar para escribirlo)');
    return p.$disconnect();
  }
  await p.$executeRawUnsafe(
    `ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "maxExtraMenus" INTEGER NOT NULL DEFAULT 1`,
  );
  const [t] = await p.$queryRawUnsafe(`SELECT COUNT(*)::int AS n FROM "Tenant"`);
  const [m] = await p.$queryRawUnsafe(
    `SELECT COUNT(*)::int AS n FROM "Tenant" WHERE "multiMenuEnabled" = true`,
  );
  console.log(`\n✅ Columna creada. Negocios: ${t.n} · con multi-carta: ${m.n}`);
  console.log('Todos quedan con el default 1. Nada más fue tocado.');
  await p.$disconnect();
})().catch(async (e) => {
  console.error('FALLÓ:', e.message); await p.$disconnect(); process.exit(1);
});
