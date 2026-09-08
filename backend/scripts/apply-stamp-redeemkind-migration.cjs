/**
 * Migración ADITIVA: agrega `Stamp.redeemKind` (texto opcional) y rellena el
 * histórico.
 *
 * Distingue el canje de un PREMIO de sellos del canje de un CUPÓN. Hace falta
 * un campo propio porque al redimir un cupón el pase se TRANSFORMA en tarjeta
 * de sellos: un minuto después, mirando la fila, ya no hay forma de saber qué
 * se canjeó. Primor Barber veía «SELLOS (30D) 2 · RECOMPENSAS (30D) 122» —las
 * 122 eran cupones de bienvenida, no premios ganados.
 *
 * Aditiva e idempotente: `ADD COLUMN IF NOT EXISTS` sobre una columna
 * nullable, y el relleno solo toca filas con `redeemKind IS NULL`.
 *
 * El relleno del histórico se apoya en la nota, que es lo único que quedó: las
 * dos rutas de cupón escriben «Cupón redimido…». Lo demás se marca REWARD.
 *
 * Uso:  railway run node scripts/apply-stamp-redeemkind-migration.cjs
 */
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

(async () => {
  const antes = await p.$queryRawUnsafe(`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'Stamp' AND column_name = 'redeemKind'
  `);

  if (!antes.length) {
    console.log('Agregando Stamp."redeemKind" (TEXT, nullable)…');
    await p.$executeRawUnsafe(
      `ALTER TABLE "Stamp" ADD COLUMN IF NOT EXISTS "redeemKind" TEXT`,
    );
  } else {
    console.log('La columna "redeemKind" ya existe.');
  }

  const pendientes = await p.$queryRawUnsafe(
    `SELECT COUNT(*)::int AS n FROM "Stamp" WHERE action = 'REDEEM' AND "redeemKind" IS NULL`,
  );
  console.log(`canjes sin clasificar: ${pendientes[0].n}`);

  if (pendientes[0].n > 0) {
    const cupones = await p.$executeRawUnsafe(`
      UPDATE "Stamp" SET "redeemKind" = 'COUPON'
      WHERE action = 'REDEEM' AND "redeemKind" IS NULL
        AND (note ILIKE 'Cup%n redimido%' OR note ILIKE '%cupón%')
    `);
    const premios = await p.$executeRawUnsafe(`
      UPDATE "Stamp" SET "redeemKind" = 'REWARD'
      WHERE action = 'REDEEM' AND "redeemKind" IS NULL
    `);
    console.log(`  marcados como CUPÓN:  ${cupones}`);
    console.log(`  marcados como PREMIO: ${premios}`);
  }

  const resumen = await p.$queryRawUnsafe(`
    SELECT COALESCE("redeemKind", '(sin clasificar)') AS clase, COUNT(*)::int AS n
    FROM "Stamp" WHERE action = 'REDEEM'
    GROUP BY 1 ORDER BY 2 DESC
  `);
  console.log('\nCanjes por clase, en toda la plataforma:');
  for (const r of resumen) console.log(`  ${r.clase.padEnd(18)} ${r.n}`);

  await p.$disconnect();
})().catch(async (e) => {
  console.error('Falló:', e.message);
  await p.$disconnect();
  process.exit(1);
});
