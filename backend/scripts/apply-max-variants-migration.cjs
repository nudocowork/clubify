/**
 * Migración ADITIVA: `Product.maxVariantsTotal` — tope de variantes por producto.
 *
 * Limita cuántas VARIANTES puede marcar el cliente. Null o 1 = se elige una
 * sola (radio), que es como funciona hoy todo. >= 2 convierte las variantes en
 * casillas multiples: "elige 2 salsas de estas 5".
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
     WHERE table_name = 'Product' AND column_name = 'maxVariantsTotal'`);
  if (antes[0].n) {
    console.log('La columna "maxVariantsTotal" ya existe. Nada que hacer.');
    return p.$disconnect();
  }

  console.log('Agregando Product."maxVariantsTotal" (INTEGER, nullable)…');
  await p.$executeRawUnsafe(
    `ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "maxVariantsTotal" INTEGER`,
  );

  const col = await p.$queryRawUnsafe(`
    SELECT column_name, data_type, is_nullable FROM information_schema.columns
     WHERE table_name = 'Product' AND column_name = 'maxVariantsTotal'`);
  console.log('\nColumna →', col[0] ?? '(no se creó)');

  // Comprobación: ningún producto cambia de comportamiento al migrar.
  const [t] = await p.$queryRawUnsafe(`SELECT COUNT(*)::int AS n FROM "Product"`);
  const [c] = await p.$queryRawUnsafe(
    `SELECT COUNT(*)::int AS n FROM "Product" WHERE "maxVariantsTotal" IS NOT NULL`,
  );
  console.log(`\nProductos: ${t.n} · con tope configurado: ${c.n} (debe ser 0 tras migrar)`);
  console.log('Listo. Nada más de la base fue tocado.');

  await p.$disconnect();
})().catch(async (e) => {
  console.error('FALLÓ:', e.message);
  await p.$disconnect();
  process.exit(1);
});
