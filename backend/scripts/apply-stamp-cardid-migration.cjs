/**
 * Migración ADITIVA: `Stamp.cardId` (texto, nullable) + índice para buscar
 * «¿este cliente ya canjeó ESTE cupón?».
 *
 * Por qué: al canjear un cupón de bienvenida el pase se transforma en la
 * tarjeta de sellos y su `cardId` deja de decir que fue un cupón. Al volver a
 * registrarse, el cliente recibía OTRO café gratis (21 casos en 7 negocios,
 * &N COFFEE entre ellos, 2026-11-24). Ahora cada sello guarda la tarjeta en la
 * que estaba el pase en ese momento.
 *
 * Además rellena el HISTÓRICO solo donde no hay duda: canjes de cupón sin
 * `cardId` de negocios con UNA sola tarjeta de cupón de un uso. Con varias no
 * se adivina (el registro tiene su propia regla de respaldo).
 *
 * Idempotente: `IF NOT EXISTS` y el relleno solo toca filas con `cardId` nulo.
 *
 * Uso (desde backend/):
 *   railway run --service backend --environment production --project <id> \
 *     node scripts/apply-stamp-cardid-migration.cjs [--aplicar]
 * Sin --aplicar solo dice qué haría.
 */
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient({
  datasources: { db: { url: process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL } },
});
const APLICAR = process.argv.includes('--aplicar');

(async () => {
  const col = await p.$queryRawUnsafe(`
    SELECT 1 FROM information_schema.columns WHERE table_name = 'Stamp' AND column_name = 'cardId'`);
  console.log(`Columna Stamp."cardId": ${col.length ? 'ya existe' : 'NO existe'}`);
  if (!APLICAR) {
    console.log('Ensayo: nada escrito. Repetir con --aplicar.');
    return;
  }
  await p.$executeRawUnsafe(`ALTER TABLE "Stamp" ADD COLUMN IF NOT EXISTS "cardId" TEXT`);
  await p.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS "Stamp_customerId_cardId_idx" ON "Stamp" ("customerId", "cardId")`,
  );
  console.log('Columna e índice listos.');

  const n = await p.$executeRawUnsafe(`
    UPDATE "Stamp" s SET "cardId" = u.id
    FROM (
      SELECT c."tenantId", min(c.id) AS id
      FROM "Card" c
      WHERE c.type IN ('COUPON','DISCOUNT','GIFT') AND c."couponIndefinido" = false
      GROUP BY c."tenantId"
      HAVING count(*) = 1
    ) u
    WHERE s."tenantId" = u."tenantId" AND s.action = 'REDEEM' AND s."redeemKind" = 'COUPON' AND s."cardId" IS NULL`);
  console.log(`Histórico: ${n} canje(s) de cupón vinculados a la única tarjeta de cupón de su negocio.`);
})()
  .catch((e) => {
    console.error('ERROR:', e.message);
    process.exitCode = 1;
  })
  .finally(() => p.$disconnect());
