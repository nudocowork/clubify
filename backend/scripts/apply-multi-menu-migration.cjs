/**
 * Migración ADITIVA: varios menús por negocio, uno por sede.
 *
 * Crea:
 *   - Tabla `Menu` (una carta, opcionalmente asignada a una `Location`).
 *   - `Category.menuId` y `Product.menuId` — **null = menú principal**, que es
 *     donde queda TODO lo que ya existía. No se migra ni una fila.
 *   - `Tenant.multiMenuEnabled` (default false) — la función se habilita
 *     negocio por negocio desde el panel de admin.
 *
 * Todo con `IF NOT EXISTS`. Ningún negocio cambia de comportamiento al correr
 * esto: sin menús creados y con el flag en false, el sistema se comporta
 * exactamente igual que antes.
 *
 * NUNCA usar `prisma db push` contra producción.
 *
 * Uso:
 *   railway run node scripts/apply-multi-menu-migration.cjs
 *   railway run node scripts/apply-multi-menu-migration.cjs --aplicar
 */
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
const APLICAR = process.argv.includes('--aplicar');

async function existeTabla(nombre) {
  const [{ n }] = await p.$queryRawUnsafe(
    `SELECT COUNT(*)::int AS n FROM information_schema.tables WHERE table_name = $1`,
    nombre,
  );
  return n > 0;
}
async function existeColumna(tabla, col) {
  const [{ n }] = await p.$queryRawUnsafe(
    `SELECT COUNT(*)::int AS n FROM information_schema.columns
      WHERE table_name = $1 AND column_name = $2`,
    tabla,
    col,
  );
  return n > 0;
}
async function existeConstraint(nombre) {
  const [{ n }] = await p.$queryRawUnsafe(
    `SELECT COUNT(*)::int AS n FROM information_schema.table_constraints
      WHERE constraint_name = $1`,
    nombre,
  );
  return n > 0;
}

(async () => {
  const pendiente = [];
  if (!(await existeTabla('Menu'))) pendiente.push('tabla Menu');
  if (!(await existeColumna('Category', 'menuId'))) pendiente.push('Category.menuId');
  if (!(await existeColumna('Product', 'menuId'))) pendiente.push('Product.menuId');
  if (!(await existeColumna('Tenant', 'multiMenuEnabled')))
    pendiente.push('Tenant.multiMenuEnabled');

  console.log(
    pendiente.length
      ? `Falta crear: ${pendiente.join(', ')}`
      : 'Todo existe ya. Nada que hacer.',
  );
  if (!pendiente.length) return p.$disconnect();

  if (!APLICAR) {
    console.log('\n(en seco — volvé a correrlo con --aplicar)');
    return p.$disconnect();
  }

  console.log('\nCreando tabla "Menu"…');
  await p.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "Menu" (
      "id"         TEXT NOT NULL,
      "tenantId"   TEXT NOT NULL,
      "name"       TEXT NOT NULL,
      "locationId" TEXT,
      "position"   INTEGER NOT NULL DEFAULT 0,
      "isActive"   BOOLEAN NOT NULL DEFAULT true,
      "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "Menu_pkey" PRIMARY KEY ("id")
    )`);
  await p.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS "Menu_tenantId_position_idx" ON "Menu"("tenantId", "position")`,
  );
  await p.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS "Menu_locationId_idx" ON "Menu"("locationId")`,
  );

  // Borrar el negocio se lleva sus menús; borrar una SEDE no puede llevarse un
  // menú entero con sus productos — solo lo deja sin asignar.
  if (!(await existeConstraint('Menu_tenantId_fkey'))) {
    await p.$executeRawUnsafe(`
      ALTER TABLE "Menu" ADD CONSTRAINT "Menu_tenantId_fkey"
      FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id")
      ON DELETE CASCADE ON UPDATE CASCADE`);
  }
  if (!(await existeConstraint('Menu_locationId_fkey'))) {
    await p.$executeRawUnsafe(`
      ALTER TABLE "Menu" ADD CONSTRAINT "Menu_locationId_fkey"
      FOREIGN KEY ("locationId") REFERENCES "Location"("id")
      ON DELETE SET NULL ON UPDATE CASCADE`);
  }
  console.log('  tabla + índices + claves foráneas.');

  console.log('\nAgregando Category."menuId" y Product."menuId" (nullable)…');
  for (const tabla of ['Category', 'Product']) {
    await p.$executeRawUnsafe(
      `ALTER TABLE "${tabla}" ADD COLUMN IF NOT EXISTS "menuId" TEXT`,
    );
    await p.$executeRawUnsafe(
      `CREATE INDEX IF NOT EXISTS "${tabla}_menuId_idx" ON "${tabla}"("menuId")`,
    );
    const fk = `${tabla}_menuId_fkey`;
    if (!(await existeConstraint(fk))) {
      await p.$executeRawUnsafe(`
        ALTER TABLE "${tabla}" ADD CONSTRAINT "${fk}"
        FOREIGN KEY ("menuId") REFERENCES "Menu"("id")
        ON DELETE CASCADE ON UPDATE CASCADE`);
    }
  }
  console.log('  columnas + índices + claves foráneas.');

  console.log('\nAgregando Tenant."multiMenuEnabled" (default false)…');
  await p.$executeRawUnsafe(
    `ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "multiMenuEnabled" BOOLEAN NOT NULL DEFAULT false`,
  );

  // Comprobación: nadie cambia de comportamiento.
  const [cat] = await p.$queryRawUnsafe(
    `SELECT COUNT(*)::int AS n FROM "Category" WHERE "menuId" IS NOT NULL`,
  );
  const [pr] = await p.$queryRawUnsafe(
    `SELECT COUNT(*)::int AS n FROM "Product" WHERE "menuId" IS NOT NULL`,
  );
  const [tn] = await p.$queryRawUnsafe(
    `SELECT COUNT(*)::int AS n FROM "Tenant" WHERE "multiMenuEnabled" = true`,
  );
  const [menus] = await p.$queryRawUnsafe(`SELECT COUNT(*)::int AS n FROM "Menu"`);
  console.log('\nEstado tras migrar (todo debe ser 0):');
  console.log(`  categorías con menú asignado : ${cat.n}`);
  console.log(`  productos con menú asignado  : ${pr.n}`);
  console.log(`  negocios con multi-menú      : ${tn.n}`);
  console.log(`  menús creados                : ${menus.n}`);
  console.log('\nListo. Ningún negocio cambia hasta que se habilite la función.');

  await p.$disconnect();
})().catch(async (e) => {
  console.error('FALLÓ:', e.message);
  await p.$disconnect();
  process.exit(1);
});
