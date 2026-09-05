/**
 * Añade `ClubPlan.periodicidad` — MENSUAL o ANUAL.
 *
 * SQL crudo y aditivo, no `prisma db push`: producción tiene índices únicos
 * parciales que Prisma no sabe expresar y un push los borra. Modelo copiado de
 * `apply-club-migration.cjs`.
 *
 * Idempotente: `ADD COLUMN IF NOT EXISTS` con DEFAULT, así los planes que ya
 * existen quedan en MENSUAL, que es lo que eran.
 *
 *   railway run node scripts/apply-club-periodicidad-migration.cjs
 */
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

const PASOS = [
  [
    'ClubPlan.periodicidad',
    `ALTER TABLE "ClubPlan"
       ADD COLUMN IF NOT EXISTS "periodicidad" TEXT NOT NULL DEFAULT 'MENSUAL'`,
  ],
];

(async () => {
  for (const [nombre, sql] of PASOS) {
    await p.$executeRawUnsafe(sql);
    console.log(`  ok · ${nombre}`);
  }

  const col = await p.$queryRawUnsafe(
    `SELECT COUNT(*)::int AS n FROM information_schema.columns
      WHERE table_name='ClubPlan' AND column_name='periodicidad'`,
  );
  if (col[0].n !== 1) throw new Error('falta ClubPlan.periodicidad');

  // Que ningún plan haya quedado con la columna vacía: el panel decide con
  // ella si el precio se lee «al mes» o «al año», y un null se leería como
  // mensual sin que nadie lo haya dicho.
  const sinValor = await p.$queryRawUnsafe(
    `SELECT COUNT(*)::int AS n FROM "ClubPlan"
      WHERE "periodicidad" IS NULL OR "periodicidad" NOT IN ('MENSUAL','ANUAL')`,
  );
  if (sinValor[0].n !== 0) {
    throw new Error(`${sinValor[0].n} planes con periodicidad inválida`);
  }

  const total = await p.clubPlan.count();
  console.log(`\nlisto · ClubPlan.periodicidad · planes existentes: ${total}`);
  await p.$disconnect();
})().catch((e) => {
  console.error('ERR', e.message);
  process.exit(1);
});
