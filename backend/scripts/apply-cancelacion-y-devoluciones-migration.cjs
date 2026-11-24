/**
 * Migración ADITIVA: cancelación ≠ suspensión, y devoluciones que se recuperan.
 *
 * 1. Tenant: de dónde salió la cancelación y por qué, por qué está suspendido,
 *    y el rastro del SMS de «verifica la cancelación en Hotmart».
 *      cancelSource, cancelReason, suspendReason, cancelNoticeSentAt,
 *      cancelNoticeTemplate — todas nullable.
 *
 * 2. Commission: un índice ÚNICO PARCIAL sobre `periodKey` para los ajustes de
 *    devolución (`DEVOL-…`). Es lo que garantiza en la base —no en el código—
 *    que una devolución recupera una comisión pagada UNA sola vez aunque
 *    Hotmart mande el aviso tres veces, el conciliador lo repase cada noche y
 *    un colaborador pulse «Registrar devolución». Prisma no sabe expresar un
 *    índice parcial: por eso va aquí y nunca con `db push` (ver CLAUDE.md).
 *
 * Aditiva e idempotente: `IF NOT EXISTS` en todo. No toca datos existentes.
 *
 * Uso (desde backend/):
 *   railway run --service backend --environment production --project <id> \
 *     node scripts/apply-cancelacion-y-devoluciones-migration.cjs
 */
const { PrismaClient } = require('@prisma/client');
// La URL PÚBLICA primero: la interna solo resuelve dentro de Railway.
const p = new PrismaClient({
  datasources: {
    db: { url: process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL },
  },
});

const COLUMNAS = [
  ['cancelSource', 'TEXT'],
  ['cancelReason', 'TEXT'],
  ['suspendReason', 'TEXT'],
  ['cancelNoticeSentAt', 'TIMESTAMP(3)'],
  ['cancelNoticeTemplate', 'TEXT'],
];

(async () => {
  for (const [col, tipo] of COLUMNAS) {
    await p.$executeRawUnsafe(`ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "${col}" ${tipo}`);
  }
  const cols = await p.$queryRawUnsafe(`
    SELECT column_name, data_type FROM information_schema.columns
    WHERE table_name = 'Tenant' AND column_name IN (${COLUMNAS.map(([c]) => `'${c}'`).join(',')})
    ORDER BY column_name
  `);
  console.log('Tenant:', cols.map((c) => `${c.column_name} (${c.data_type})`).join(', '));
  if (cols.length !== COLUMNAS.length) throw new Error('Faltan columnas en Tenant.');

  // Antes de crear el índice único: ¿hay ya dos ajustes con la misma clave? No
  // debería (los ajustes DEVOL- nacen con este cambio), pero si los hubiera el
  // CREATE fallaría a medias y es mejor decirlo claro.
  const dup = await p.$queryRawUnsafe(`
    SELECT "periodKey", COUNT(*)::int AS n FROM "Commission"
    WHERE "periodKey" LIKE 'DEVOL-%' GROUP BY "periodKey" HAVING COUNT(*) > 1
  `);
  if (dup.length) {
    console.log('Ajustes duplicados, revisar antes de crear el índice:', dup);
    throw new Error('Hay periodKey DEVOL- duplicados.');
  }
  await p.$executeRawUnsafe(`
    CREATE UNIQUE INDEX IF NOT EXISTS "Commission_ajuste_de_devolucion_key"
    ON "Commission" ("periodKey") WHERE "periodKey" LIKE 'DEVOL-%'
  `);
  const idx = await p.$queryRawUnsafe(`
    SELECT indexname, indexdef FROM pg_indexes
    WHERE tablename = 'Commission' AND indexname = 'Commission_ajuste_de_devolucion_key'
  `);
  console.log('Índice:', idx[0]?.indexdef ?? '(no se creó)');
  if (!idx.length) throw new Error('No se creó el índice.');
  console.log('\nListo.');
  await p.$disconnect();
})().catch(async (e) => {
  console.error('ERROR:', e.message);
  await p.$disconnect();
  process.exit(1);
});
