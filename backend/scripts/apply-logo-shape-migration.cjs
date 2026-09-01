/**
 * Añade `Card.logoShape` — la forma del logo en la tarjeta.
 *
 * SQL crudo y aditivo con `IF NOT EXISTS`, no `prisma db push`: producción
 * tiene índices únicos parciales que Prisma no sabe expresar y un push los
 * borra. Modelo copiado de `apply-email-config-migration.cjs`.
 *
 * Idempotente: correrlo dos veces no hace nada la segunda.
 *
 *   railway run node scripts/apply-logo-shape-migration.cjs
 */
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

(async () => {
  // Nullable y sin default: null = ROUNDED, que es como se ha pintado
  // siempre. Ninguna tarjeta ya publicada cambia de aspecto.
  await p.$executeRawUnsafe(
    `ALTER TABLE "Card" ADD COLUMN IF NOT EXISTS "logoShape" TEXT`,
  );

  const [{ count }] = await p.$queryRawUnsafe(
    `SELECT COUNT(*)::int AS count
       FROM information_schema.columns
      WHERE table_name = 'Card' AND column_name = 'logoShape'`,
  );
  if (count !== 1) throw new Error('la columna no quedó creada');

  const tarjetas = await p.card.count();
  const conForma = await p.card.count({ where: { logoShape: { not: null } } });
  console.log(
    `ok · Card.logoShape existe · ${tarjetas} tarjetas, ${conForma} con forma propia (el resto usa ROUNDED)`,
  );
  await p.$disconnect();
})().catch((e) => {
  console.error('ERR', e.message);
  process.exit(1);
});
