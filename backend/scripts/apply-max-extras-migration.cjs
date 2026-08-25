/**
 * Migración ADITIVA: `Product.maxExtrasTotal` — tope de extras por producto.
 *
 * Limita cuántos extras puede elegir el cliente EN TOTAL. Distinto de
 * `ProductExtra.maxQty`, que limita un extra concreto: un producto puede
 * ofrecer 20 ingredientes y permitir solo 5.
 *
 * Aditiva e idempotente: `ADD COLUMN IF NOT EXISTS` sobre una columna nullable.
 * Null = sin tope, que es el comportamiento de hoy — ningún producto cambia.
 * NUNCA usar `prisma db push` contra producción.
 *
 * Uso:  railway run node scripts/apply-max-extras-migration.cjs
 */
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

(async () => {
  const antes = await p.$queryRawUnsafe(`
    SELECT COUNT(*)::int AS n FROM information_schema.columns
     WHERE table_name = 'Product' AND column_name = 'maxExtrasTotal'`);
  if (antes[0].n) {
    console.log('La columna "maxExtrasTotal" ya existe. Nada que hacer.');
    return p.$disconnect();
  }

  console.log('Agregando Product."maxExtrasTotal" (INTEGER, nullable)…');
  await p.$executeRawUnsafe(
    `ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "maxExtrasTotal" INTEGER`,
  );

  const col = await p.$queryRawUnsafe(`
    SELECT column_name, data_type, is_nullable FROM information_schema.columns
     WHERE table_name = 'Product' AND column_name = 'maxExtrasTotal'`);
  console.log('\nColumna →', col[0] ?? '(no se creó)');

  // Comprobación: ningún producto cambia de comportamiento al migrar.
  const [t] = await p.$queryRawUnsafe(`SELECT COUNT(*)::int AS n FROM "Product"`);
  const [c] = await p.$queryRawUnsafe(
    `SELECT COUNT(*)::int AS n FROM "Product" WHERE "maxExtrasTotal" IS NOT NULL`,
  );
  console.log(`\nProductos: ${t.n} · con tope configurado: ${c.n} (debe ser 0 tras migrar)`);
  console.log('Listo. Nada más de la base fue tocado.');

  await p.$disconnect();
})().catch(async (e) => {
  console.error('FALLÓ:', e.message);
  await p.$disconnect();
  process.exit(1);
});
