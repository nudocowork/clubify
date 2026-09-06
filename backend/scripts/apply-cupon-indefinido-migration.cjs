/**
 * Añade `Card.couponIndefinido` — el cupón que se puede canjear siempre.
 *
 * SQL crudo y aditivo, no `prisma db push`: producción tiene índices únicos
 * parciales que Prisma no sabe expresar y un push los borra.
 *
 * Idempotente y con DEFAULT false: todos los cupones que ya existen siguen
 * siendo de un solo uso, que es lo que eran. Volverlos indefinidos es una
 * decisión de cada negocio, tarjeta por tarjeta.
 *
 *   railway run node scripts/apply-cupon-indefinido-migration.cjs
 */
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

(async () => {
  await p.$executeRawUnsafe(
    `ALTER TABLE "Card"
       ADD COLUMN IF NOT EXISTS "couponIndefinido" BOOLEAN NOT NULL DEFAULT false`,
  );
  console.log('  ok · Card.couponIndefinido');

  const col = await p.$queryRawUnsafe(
    `SELECT COUNT(*)::int AS n FROM information_schema.columns
      WHERE table_name='Card' AND column_name='couponIndefinido'`,
  );
  if (col[0].n !== 1) throw new Error('falta Card.couponIndefinido');

  const cupones = await p.card.count({
    where: { type: { in: ['COUPON', 'DISCOUNT', 'GIFT'] } },
  });
  const indefinidos = await p.card.count({ where: { couponIndefinido: true } });
  console.log(`\nlisto · cupones: ${cupones} · indefinidos: ${indefinidos}`);
  await p.$disconnect();
})().catch((e) => {
  console.error('ERR', e.message);
  process.exit(1);
});
