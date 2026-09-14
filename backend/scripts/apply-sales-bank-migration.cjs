/**
 * «Banco» de un equipo de ventas: la cola de CITAS por asignar y por confirmar.
 *
 * Aditiva e idempotente: solo añade columnas nullable (o con default) a
 * `SalesMeeting` y un índice. No toca ninguna fila. Nunca `prisma db push`.
 *
 * POR QUÉ ESTAS COLUMNAS
 * ----------------------
 * La pestaña «Banco» enseñaba los leads sin vendedor. En TeamClubify el banco es
 * otra cosa: la cola donde quien coordina reparte las citas entre los closers y
 * persigue que el cliente confirme. Para eso una cita necesita saber tres cosas
 * que `SalesMeeting` no guardaba:
 *
 * · **Quién la asignó y cuándo** (`assignedAt`, `assignedByUserId`). `hostUserId`
 *   ya dice a quién le toca; esto dice que alguien lo decidió, para el historial.
 * · **Si el cliente confirmó a mano** (`confirmedAt`, `confirmedByUserId`).
 * · **Los dos recordatorios** (`conf1h`, `conf30min` y sus fechas). Son lo que
 *   pinta el semáforo y lo que ordena la cola: una cita con las dos
 *   confirmaciones va antes que una sin ninguna, aunque sean a la misma hora.
 *
 * Booleanos con default `false` y no fechas solas: el semáforo pregunta «¿lo
 * confirmó?» cien veces por pantalla, y la fecha es para saber cuándo.
 *
 * Uso:  railway run --service Postgres-Nq8w node scripts/apply-sales-bank-migration.cjs [--aplicar]
 */
const { PrismaClient } = require('@prisma/client');

const APLICAR = process.argv.includes('--aplicar');
const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
const p = new PrismaClient({ datasources: { db: { url } } });

const COLUMNAS = [
  ['assignedAt', 'TIMESTAMP(3)'],
  ['assignedByUserId', 'TEXT'],
  ['confirmedAt', 'TIMESTAMP(3)'],
  ['confirmedByUserId', 'TEXT'],
  ['conf1h', 'BOOLEAN NOT NULL DEFAULT false'],
  ['conf1hAt', 'TIMESTAMP(3)'],
  ['conf30min', 'BOOLEAN NOT NULL DEFAULT false'],
  ['conf30minAt', 'TIMESTAMP(3)'],
];

/** La consulta del banco filtra por equipo y estado, y ordena por hora. */
const INDICE = `CREATE INDEX IF NOT EXISTS "SalesMeeting_salesTeamId_status_startAt_idx" ON "SalesMeeting"("salesTeamId","status","startAt")`;

(async () => {
  if (!url) { console.error('No DATABASE_URL'); process.exit(1); }
  console.log(APLICAR ? '*** APLICANDO ***' : 'ENSAYO (no escribe nada)');

  const ya = await p.$queryRawUnsafe(
    `SELECT column_name FROM information_schema.columns WHERE table_name = 'SalesMeeting'`,
  );
  const existentes = new Set(ya.map((c) => c.column_name));

  const pendientes = COLUMNAS.filter(([c]) => !existentes.has(c));
  const sentencias = [
    ...pendientes.map(([c, tipo]) => `ALTER TABLE "SalesMeeting" ADD COLUMN IF NOT EXISTS "${c}" ${tipo}`),
    INDICE,
  ];

  console.log(`columnas que ya existían: ${COLUMNAS.length - pendientes.length}/${COLUMNAS.length}`);
  if (!APLICAR) {
    for (const s of sentencias) console.log(`   ${s};`);
    console.log('\n-- ENSAYO. Con --aplicar se ejecuta lo de arriba.');
    await p.$disconnect();
    return;
  }

  for (const s of sentencias) {
    await p.$executeRawUnsafe(s);
    console.log(`  ✓ ${s}`);
  }
  const [{ n }] = await p.$queryRawUnsafe(`SELECT COUNT(*)::int AS n FROM "SalesMeeting"`);
  console.log(`\nlisto · ${n} citas, ninguna modificada (las columnas nuevas nacen vacías o en false)`);
  await p.$disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
