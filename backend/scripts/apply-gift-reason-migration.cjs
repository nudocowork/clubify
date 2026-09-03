/**
 * Migración ADITIVA: `Product.giftReason` — tope de variantes por producto.
 *
 * Por que se REGALO un sello: COURTESY o SPECIAL_DATE. Null = sello normal,
 * con su compra detras. Campo propio (no dentro de `note`) para que el negocio
 * pueda medir cuantos sellos regala y por que.
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
     WHERE table_name = 'Stamp' AND column_name = 'giftReason'`);
  if (antes[0].n) {
    console.log('La columna "giftReason" ya existe. Nada que hacer.');
    return p.$disconnect();
  }

  console.log('Agregando Product."giftReason" (TEXT, nullable)…');
  await p.$executeRawUnsafe(
    `ALTER TABLE "Stamp" ADD COLUMN IF NOT EXISTS "giftReason" TEXT`,
  );

  const col = await p.$queryRawUnsafe(`
    SELECT column_name, data_type, is_nullable FROM information_schema.columns
     WHERE table_name = 'Stamp' AND column_name = 'giftReason'`);
  console.log('\nColumna →', col[0] ?? '(no se creó)');

  // Comprobación: ningún producto cambia de comportamiento al migrar.
  const [t] = await p.$queryRawUnsafe(`SELECT COUNT(*)::int AS n FROM "Stamp"`);
  const [c] = await p.$queryRawUnsafe(
    `SELECT COUNT(*)::int AS n FROM "Stamp" WHERE "giftReason" IS NOT NULL`,
  );
  console.log(`\nSellos: ${t.n} · regalados: ${c.n} (debe ser 0 tras migrar)`);
  console.log('Listo. Nada más de la base fue tocado.');

  await p.$disconnect();
})().catch(async (e) => {
  console.error('FALLÓ:', e.message);
  await p.$disconnect();
  process.exit(1);
});
