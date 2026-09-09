/**
 * Los dos límites de ritmo de la Tarjeta de Club.
 *
 * El cupo es mensual y nada regulaba la velocidad: con 10 al mes se podían
 * llevar los 10 en un minuto. Reportado por Javier el 2026-09-09 sobre su
 * propia tarjeta, y con rastro en producción (DEMO CLUBIFY, tres consumos en
 * dos minutos y medio el 2026-09-08).
 *
 * SQL crudo y aditivo, no `prisma db push`: producción tiene índices únicos
 * parciales que Prisma no sabe expresar y un push los borra.
 *
 * Las dos columnas nacen NULL = «sin límite», que es el comportamiento de hoy.
 * A propósito: encender un tope de oficio le cambiaría las reglas a socios que
 * ya pagaron.
 *
 *   railway run node scripts/apply-club-frecuencia-migration.cjs
 */
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

const PASOS = [
  [
    'ClubPlan.maxPorDia',
    `ALTER TABLE "ClubPlan" ADD COLUMN IF NOT EXISTS "maxPorDia" INTEGER`,
  ],
  [
    'ClubPlan.minutosEntreConsumos',
    `ALTER TABLE "ClubPlan" ADD COLUMN IF NOT EXISTS "minutosEntreConsumos" INTEGER`,
  ],
  // El tope diario se cuenta leyendo los consumos del día. Sin este índice, el
  // recuento hace un scan de la membresía entera en cada escaneo — barato hoy
  // con 4 consumos, caro el día que un socio lleve dos años.
  [
    'índice ClubConsumo (vivos por fecha)',
    `CREATE INDEX IF NOT EXISTS "ClubConsumo_membresiaId_createdAt_vivos_idx"
       ON "ClubConsumo"("membresiaId","createdAt")
       WHERE "revertedAt" IS NULL`,
  ],
];

(async () => {
  for (const [nombre, sql] of PASOS) {
    await p.$executeRawUnsafe(sql);
    console.log(`  ok · ${nombre}`);
  }

  const cols = await p.$queryRawUnsafe(
    `SELECT column_name, is_nullable FROM information_schema.columns
      WHERE table_name='ClubPlan' AND column_name IN ('maxPorDia','minutosEntreConsumos')
      ORDER BY column_name`,
  );
  if (cols.length !== 2) {
    throw new Error(`esperaba 2 columnas nuevas, hay ${cols.length}`);
  }
  // Que sean NULLABLE no es un detalle: NULL es el valor que significa «sin
  // límite», y una columna NOT NULL con default 0 dejaría a todos los planes
  // con un tope de cero, o sea sin poder consumir nada.
  for (const c of cols) {
    if (c.is_nullable !== 'YES') {
      throw new Error(`${c.column_name} tiene que admitir NULL (= sin límite)`);
    }
  }

  const conLimite = await p.$queryRawUnsafe(
    `SELECT COUNT(*)::int AS n FROM "ClubPlan"
      WHERE "maxPorDia" IS NOT NULL OR "minutosEntreConsumos" IS NOT NULL`,
  );
  const total = await p.clubPlan.count();
  console.log(
    `\nlisto · ${total} plan(es) de club · con algún límite puesto: ${conLimite[0].n}`,
  );
  await p.$disconnect();
})().catch((e) => {
  console.error('ERR', e.message);
  process.exit(1);
});
