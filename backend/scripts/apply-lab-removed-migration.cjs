/**
 * Migración ADITIVA: el Lab puede retirar una propuesta sin borrarla.
 *
 * Tres columnas nullable en `LabProposal`:
 *   · removedAt      — cuándo la retiró la plataforma
 *   · removedById    — quién
 *   · removedReason  — motivo, que se le enseña a la marca
 *
 * Antes, quitar una propuesta de una marca BORRABA la fila: en el Lab de Sellea
 * desaparecía sin explicación y Humberto volvía a proponerla. Ahora en su sitio
 * queda «Clubify la eliminó del panel».
 *
 * Aditiva e idempotente (`ADD COLUMN IF NOT EXISTS` sobre columnas nullable).
 * No toca ni una fila existente: todas quedan con `removedAt` nulo, que es
 * «no retirada» — el comportamiento de hoy.
 *
 * Uso:
 *   cd backend
 *   railway run --service Postgres-Nq8w node scripts/apply-lab-removed-migration.cjs
 */
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

const COLUMNAS = [
  ['removedAt', 'TIMESTAMP(3)'],
  ['removedById', 'TEXT'],
  ['removedReason', 'TEXT'],
];

const columna = (col) =>
  p.$queryRawUnsafe(
    `SELECT column_name, data_type, is_nullable
     FROM information_schema.columns
     WHERE table_name = 'LabProposal' AND column_name = $1`,
    col,
  );

(async () => {
  for (const [col, tipo] of COLUMNAS) {
    if ((await columna(col)).length) {
      console.log(`LabProposal."${col}" ya existe.`);
      continue;
    }
    console.log(`Agregando LabProposal."${col}" (${tipo}, nullable)…`);
    await p.$executeRawUnsafe(
      `ALTER TABLE "LabProposal" ADD COLUMN IF NOT EXISTS "${col}" ${tipo}`,
    );
  }

  console.log('\nEstado tras la migración:');
  for (const [col] of COLUMNAS) {
    const [c] = await columna(col);
    console.log(
      `  LabProposal."${col}":`,
      c ? `${c.data_type} nullable=${c.is_nullable}` : 'NO EXISTE',
    );
  }

  // Ninguna propuesta viva puede salir de aquí marcada como retirada.
  const [conteo] = await p.$queryRawUnsafe(`
    SELECT COUNT(*)::int AS total,
           COUNT("removedAt")::int AS retiradas
    FROM "LabProposal"
  `);
  console.log(
    `\n  ${conteo.total} propuestas · ${conteo.retiradas} retiradas` +
      (conteo.retiradas === 0 ? ' (correcto en una primera aplicación)' : ''),
  );
  if (conteo.retiradas !== 0) {
    console.log('  ⚠ Se esperaba 0. Míralo antes de desplegar.');
  }

  await p.$disconnect();
})().catch(async (e) => {
  console.error('ERROR:', e.message);
  await p.$disconnect();
  process.exit(1);
});
