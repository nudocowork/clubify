/**
 * Crea `AffiliateSaleAlert` — el registro de los avisos de venta al afiliado.
 *
 * SQL crudo y aditivo, no `prisma db push`: producción tiene índices únicos
 * parciales que Prisma no sabe expresar y un push los borra.
 *
 * Sin FK a `Commission` a propósito: el motor de comisiones lo lleva otra
 * persona y esta tabla solo lee. Una FK obligaría a declarar la relación en su
 * modelo.
 *
 *   railway run node scripts/apply-affiliate-sale-alerts-migration.cjs
 */
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

const PASOS = [
  [
    'tabla AffiliateSaleAlert',
    `CREATE TABLE IF NOT EXISTS "AffiliateSaleAlert" (
       "id"             TEXT PRIMARY KEY,
       "commissionId"   TEXT NOT NULL,
       "referralCodeId" TEXT NOT NULL,
       "phone"          TEXT NOT NULL,
       "esRenovacion"   BOOLEAN NOT NULL DEFAULT false,
       "sentAt"         TIMESTAMP(3),
       "ok"             BOOLEAN NOT NULL DEFAULT false,
       "error"          TEXT,
       "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
     )`,
  ],
  [
    'índice único por comisión',
    // Es el candado anti-duplicado: la fila se inserta ANTES de mandar el SMS,
    // así que dos pasadas del cron cruzadas chocan aquí en vez de mandar dos
    // mensajes al afiliado.
    `CREATE UNIQUE INDEX IF NOT EXISTS "AffiliateSaleAlert_commissionId_key"
       ON "AffiliateSaleAlert"("commissionId")`,
  ],
  [
    'índice por afiliado',
    `CREATE INDEX IF NOT EXISTS "AffiliateSaleAlert_referralCodeId_createdAt_idx"
       ON "AffiliateSaleAlert"("referralCodeId","createdAt")`,
  ],
];

(async () => {
  for (const [nombre, sql] of PASOS) {
    await p.$executeRawUnsafe(sql);
    console.log(`  ok · ${nombre}`);
  }

  const t = await p.$queryRawUnsafe(
    `SELECT COUNT(*)::int AS n FROM information_schema.tables
      WHERE table_name='AffiliateSaleAlert'`,
  );
  if (t[0].n !== 1) throw new Error('falta la tabla AffiliateSaleAlert');

  console.log(`\nlisto · avisos registrados: ${await p.affiliateSaleAlert.count()}`);
  await p.$disconnect();
})().catch((e) => {
  console.error('ERR', e.message);
  process.exit(1);
});
