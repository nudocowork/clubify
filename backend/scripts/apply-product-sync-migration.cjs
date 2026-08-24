/**
 * Migración ADITIVA: sincronización de productos entre cartas.
 *
 *   - `Product.sourceProductId` → de qué producto salió esta copia.
 *   - `Product.syncWithSource`  → si sigue al original (default false).
 *
 * La FK es `SET NULL`, no `CASCADE`: borrar un producto del menú principal NO
 * puede vaciarle la carta a una sede. La copia queda independiente.
 *
 * Nadie cambia de comportamiento: sin copias creadas, ambas columnas quedan
 * vacías y todo funciona igual que antes.
 *
 * Uso:
 *   railway run node scripts/apply-product-sync-migration.cjs
 *   railway run node scripts/apply-product-sync-migration.cjs --aplicar
 */
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
const APLICAR = process.argv.includes('--aplicar');

(async () => {
  const [{ n }] = await p.$queryRawUnsafe(`
    SELECT COUNT(*)::int AS n FROM information_schema.columns
     WHERE table_name = 'Product' AND column_name = 'sourceProductId'`);
  if (n) {
    console.log('Las columnas ya existen. Nada que hacer.');
    return p.$disconnect();
  }
  if (!APLICAR) {
    console.log('Faltan Product.sourceProductId y Product.syncWithSource.');
    console.log('(en seco — volvé a correrlo con --aplicar)');
    return p.$disconnect();
  }

  console.log('Agregando columnas…');
  await p.$executeRawUnsafe(
    `ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "sourceProductId" TEXT`,
  );
  await p.$executeRawUnsafe(
    `ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "syncWithSource" BOOLEAN NOT NULL DEFAULT false`,
  );
  await p.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS "Product_sourceProductId_idx" ON "Product"("sourceProductId")`,
  );

  const [{ f }] = await p.$queryRawUnsafe(`
    SELECT COUNT(*)::int AS f FROM information_schema.table_constraints
     WHERE constraint_name = 'Product_sourceProductId_fkey'`);
  if (!f) {
    await p.$executeRawUnsafe(`
      ALTER TABLE "Product" ADD CONSTRAINT "Product_sourceProductId_fkey"
      FOREIGN KEY ("sourceProductId") REFERENCES "Product"("id")
      ON DELETE SET NULL ON UPDATE CASCADE`);
    console.log('  FK creada (SET NULL: borrar el original no borra la copia).');
  }

  const [c] = await p.$queryRawUnsafe(
    `SELECT COUNT(*)::int AS n FROM "Product" WHERE "sourceProductId" IS NOT NULL`,
  );
  const [t] = await p.$queryRawUnsafe(`SELECT COUNT(*)::int AS n FROM "Product"`);
  console.log(`\nProductos: ${t.n} · con origen: ${c.n} (debe ser 0 tras migrar)`);
  console.log('Listo. Nada más de la base fue tocado.');
  await p.$disconnect();
})().catch(async (e) => {
  console.error('FALLÓ:', e.message);
  await p.$disconnect();
  process.exit(1);
});
