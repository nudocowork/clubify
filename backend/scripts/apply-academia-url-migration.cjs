/**
 * Migración ADITIVA: `WhiteLabel.academiaUrl` — tope de variantes por producto.
 *
 * Academia propia de cada marca para sus afiliados. Null = la marca no tiene,
 * y la pestaña no se muestra — en vez de mandarlos a la de Clubify, que es
 * lo que pasaba con el enlace escrito a mano.
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
     WHERE table_name = 'WhiteLabel' AND column_name = 'academiaUrl'`);
  if (antes[0].n) {
    console.log('La columna "academiaUrl" ya existe. Nada que hacer.');
    return p.$disconnect();
  }

  console.log('Agregando WhiteLabel."academiaUrl" (TEXT, nullable)…');
  await p.$executeRawUnsafe(
    `ALTER TABLE "WhiteLabel" ADD COLUMN IF NOT EXISTS "academiaUrl" TEXT`,
  );

  const col = await p.$queryRawUnsafe(`
    SELECT column_name, data_type, is_nullable FROM information_schema.columns
     WHERE table_name = 'WhiteLabel' AND column_name = 'academiaUrl'`);
  console.log('\nColumna →', col[0] ?? '(no se creó)');

  // Comprobación: ningún producto cambia de comportamiento al migrar.
  const [t] = await p.$queryRawUnsafe(`SELECT COUNT(*)::int AS n FROM "WhiteLabel"`);
  const [c] = await p.$queryRawUnsafe(
    `SELECT COUNT(*)::int AS n FROM "WhiteLabel" WHERE "academiaUrl" IS NOT NULL`,
  );
  console.log(`\nMarcas: ${t.n} · con tope configurado: ${c.n} (debe ser 0 tras migrar)`);
  console.log('Listo. Nada más de la base fue tocado.');

  await p.$disconnect();
})().catch(async (e) => {
  console.error('FALLÓ:', e.message);
  await p.$disconnect();
  process.exit(1);
});
