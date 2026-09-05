/**
 * Añade `Storefront.instagramButtonEnabled`.
 *
 * SQL crudo y aditivo, no `prisma db push`: producción tiene índices únicos
 * parciales que Prisma no sabe expresar y un push los borra.
 *
 * Idempotente y con DEFAULT true: los negocios que hoy enseñan el botón lo
 * siguen enseñando. Quitarlo es una decisión de cada negocio, no nuestra.
 *
 *   railway run node scripts/apply-instagram-boton-migration.cjs
 */
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

(async () => {
  await p.$executeRawUnsafe(
    `ALTER TABLE "Storefront"
       ADD COLUMN IF NOT EXISTS "instagramButtonEnabled" BOOLEAN NOT NULL DEFAULT true`,
  );
  console.log('  ok · Storefront.instagramButtonEnabled');

  const col = await p.$queryRawUnsafe(
    `SELECT COUNT(*)::int AS n FROM information_schema.columns
      WHERE table_name='Storefront' AND column_name='instagramButtonEnabled'`,
  );
  if (col[0].n !== 1) throw new Error('falta Storefront.instagramButtonEnabled');

  const total = await p.storefront.count();
  console.log(`\nlisto · tiendas existentes: ${total}`);
  await p.$disconnect();
})().catch((e) => {
  console.error('ERR', e.message);
  process.exit(1);
});
