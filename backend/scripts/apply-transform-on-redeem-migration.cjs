/**
 * Migración ADITIVA: agrega `Card.transformOnRedeem` (boolean, default true).
 *
 * Hasta ahora un cupón SIEMPRE se convertía en tarjeta de sellos al canjearse,
 * y no había forma de decir "en ninguna": `transformIntoCardId = null` ya
 * significa "auto, la primera tarjeta de sellos activa". Con este campo el
 * negocio puede repartir un descuento suelto sin meter al cliente en su
 * programa de sellos.
 *
 * Aditiva e idempotente: `ADD COLUMN IF NOT EXISTS` con DEFAULT true, que es
 * exactamente lo que el sistema hacía hasta hoy. Ningún cupón ya emitido
 * cambia de comportamiento. Se puede correr varias veces sin efecto.
 *
 * Uso:  railway run node scripts/apply-transform-on-redeem-migration.cjs
 */
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

(async () => {
  const antes = await p.$queryRawUnsafe(`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'Card' AND column_name = 'transformOnRedeem'
  `);
  if (antes.length) {
    console.log('La columna "transformOnRedeem" ya existe. Nada que hacer.');
    return p.$disconnect();
  }

  console.log('Agregando Card."transformOnRedeem" (BOOLEAN NOT NULL DEFAULT true)…');
  await p.$executeRawUnsafe(
    `ALTER TABLE "Card" ADD COLUMN IF NOT EXISTS "transformOnRedeem" BOOLEAN NOT NULL DEFAULT true`,
  );

  const despues = await p.$queryRawUnsafe(`
    SELECT column_name, data_type, column_default, is_nullable
    FROM information_schema.columns
    WHERE table_name = 'Card' AND column_name = 'transformOnRedeem'
  `);
  console.log('Listo:', JSON.stringify(despues[0]));

  const cupones = await p.$queryRawUnsafe(`
    SELECT COUNT(*)::int AS n FROM "Card"
    WHERE "type" IN ('COUPON', 'DISCOUNT', 'GIFT')
  `);
  console.log(
    `Cupones existentes: ${cupones[0].n}. Todos quedan en true — se siguen ` +
      `convirtiendo en tarjeta de sellos, igual que antes.`,
  );

  await p.$disconnect();
})().catch(async (e) => {
  console.error('ERROR:', e.message);
  await p.$disconnect();
  process.exit(1);
});
