/**
 * Migración ADITIVA: `ProductLocation` + `Product.locationMode`.
 *
 * Es el primer paso del menú por sede sin duplicar el catálogo. Deliberadamente
 * NO la usa nadie todavía: la tabla se crea vacía y el código sigue leyendo el
 * catálogo exactamente igual que ayer. Se despliega sola para que, si algo
 * estuviera mal, se vea con la tabla vacía y no en medio del cambio de lógica.
 *
 * Por qué es segura:
 *
 *   · `CREATE TABLE IF NOT EXISTS` — no toca ninguna tabla existente.
 *   · `ADD COLUMN IF NOT EXISTS ... DEFAULT 'TODAS'` — los 3.418 productos que
 *     ya existen quedan en «todas las sedes», que es lo que hacen HOY. Ni uno
 *     cambia de comportamiento.
 *   · Idempotente: se puede correr las veces que haga falta.
 *
 * La regla que sostiene todo: **sin filas = en todas las sedes**, incluidas
 * las que se abran mañana. Por eso 25 de los 26 negocios con varias sedes
 * —que comparten una sola carta— no tienen que tocar nada nunca.
 *
 * Uso:  railway run node scripts/apply-product-location-migration.cjs
 */
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

const existeTabla = `
  SELECT to_regclass('public."ProductLocation"') IS NOT NULL AS existe
`;
const existeColumna = `
  SELECT column_name, column_default, is_nullable
  FROM information_schema.columns
  WHERE table_name = 'Product' AND column_name = 'locationMode'
`;

(async () => {
  const [{ existe }] = await p.$queryRawUnsafe(existeTabla);
  console.log(`Tabla "ProductLocation": ${existe ? 'ya existe' : 'no existe'}`);

  if (!existe) {
    console.log('Creándola…');
    await p.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "ProductLocation" (
        "id"          TEXT NOT NULL,
        "productId"   TEXT NOT NULL,
        "locationId"  TEXT NOT NULL,
        "selected"    BOOLEAN NOT NULL DEFAULT true,
        "price"       DECIMAL(10,2),
        "isAvailable" BOOLEAN,
        "stock"       INTEGER,
        "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "ProductLocation_pkey" PRIMARY KEY ("id")
      )
    `);
  }

  // El único por producto+sede. Sin él, dos guardados a la vez dejan dos
  // precios distintos para la misma sede y gana el que lea primero.
  await p.$executeRawUnsafe(`
    CREATE UNIQUE INDEX IF NOT EXISTS "ProductLocation_productId_locationId_key"
      ON "ProductLocation"("productId", "locationId")
  `);
  await p.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "ProductLocation_locationId_idx"
      ON "ProductLocation"("locationId")
  `);

  // Las claves foráneas, en su propio try: si ya están, Postgres no tiene
  // `ADD CONSTRAINT IF NOT EXISTS`.
  for (const [nombre, sql] of [
    [
      'ProductLocation_productId_fkey',
      `ALTER TABLE "ProductLocation" ADD CONSTRAINT "ProductLocation_productId_fkey"
         FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE`,
    ],
    [
      'ProductLocation_locationId_fkey',
      `ALTER TABLE "ProductLocation" ADD CONSTRAINT "ProductLocation_locationId_fkey"
         FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE CASCADE ON UPDATE CASCADE`,
    ],
  ]) {
    const [{ existe: yaEsta }] = await p.$queryRawUnsafe(`
      SELECT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = '${nombre}'
      ) AS existe
    `);
    if (yaEsta) {
      console.log(`  FK ${nombre}: ya estaba`);
      continue;
    }
    await p.$executeRawUnsafe(sql);
    console.log(`  FK ${nombre}: creada`);
  }

  // La columna del modo. DEFAULT 'TODAS' = lo que hacen hoy los productos.
  const antes = await p.$queryRawUnsafe(existeColumna);
  if (antes.length) {
    console.log('Columna "Product.locationMode": ya existe');
  } else {
    console.log('Agregando "Product.locationMode" (TEXT NOT NULL DEFAULT \'TODAS\')…');
    await p.$executeRawUnsafe(
      `ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "locationMode" TEXT NOT NULL DEFAULT 'TODAS'`,
    );
  }

  // ── Comprobación: nada cambió de comportamiento ──────────────────────
  const [{ n: productos }] = await p.$queryRawUnsafe(
    `SELECT COUNT(*)::int AS n FROM "Product"`,
  );
  const [{ n: enTodas }] = await p.$queryRawUnsafe(
    `SELECT COUNT(*)::int AS n FROM "Product" WHERE "locationMode" = 'TODAS'`,
  );
  const [{ n: filas }] = await p.$queryRawUnsafe(
    `SELECT COUNT(*)::int AS n FROM "ProductLocation"`,
  );
  console.log(`\nProductos: ${productos}`);
  console.log(`  en «todas las sedes»: ${enTodas}`);
  console.log(`  filas de ProductLocation: ${filas}  (debe ser 0: todavía no la usa nadie)`);
  if (productos !== enTodas) {
    console.log('\n  ⚠ Hay productos fuera de «TODAS». Revisar antes de seguir.');
  } else {
    console.log('\n  ✓ Ni un producto cambió de comportamiento.');
  }

  await p.$disconnect();
})().catch(async (e) => {
  console.error('Falló:', e.message);
  await p.$disconnect();
  process.exit(1);
});
