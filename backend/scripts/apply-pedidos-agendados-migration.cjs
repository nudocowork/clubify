/**
 * Pedidos agendados + idempotencia del checkout público.
 *
 * Añade a "Order":
 *   · scheduledFor    TIMESTAMPTZ NULL — cuándo quiere el cliente su domicilio.
 *   · clientRequestId TEXT NULL        — id del intento de compra del checkout.
 *   · índice (tenantId, scheduledFor)  — la vista «Pedidos agendados» del panel.
 *   · índice ÚNICO PARCIAL (tenantId, clientRequestId) WHERE clientRequestId
 *     IS NOT NULL — lo que impide que un doble toque o un reintento creen dos
 *     pedidos. Parcial porque todos los pedidos anteriores y los del panel
 *     tienen NULL; Prisma no sabe expresarlo, por eso no está en el esquema.
 *
 * SQL crudo y aditivo, no `prisma db push`: producción tiene índices únicos
 * parciales que Prisma no sabe expresar y un push los borra (este script crea
 * uno más). Modelo: `apply-email-config-migration.cjs`.
 *
 * Idempotente: `IF NOT EXISTS` en todo; correrlo dos veces no hace nada la
 * segunda. Ninguna fila existente cambia: las dos columnas nacen en NULL, que
 * es «pedido para ahora» y «sin id de intento» — exactamente lo de hoy.
 *
 * ORDEN: correr ANTES de desplegar el backend que trae estas columnas en el
 * esquema. Prisma pide las columnas por nombre en cada consulta de pedidos: un
 * backend nuevo contra una base sin ellas rompe TODOS los pedidos, no solo los
 * agendados. Al revés no pasa nada: el backend viejo ignora columnas que no
 * conoce.
 *
 * Los CREATE INDEX van sin CONCURRENTLY a propósito: "Order" tiene pocos
 * miles de filas (se imprimen abajo) y el bloqueo de escritura dura
 * milisegundos; CONCURRENTLY, si falla a medias, deja un índice INVÁLIDO que
 * `IF NOT EXISTS` da por bueno en la siguiente pasada.
 *
 * Uso:  railway run node scripts/apply-pedidos-agendados-migration.cjs
 */
const { PrismaClient } = require('@prisma/client');
// `railway run` inyecta la `DATABASE_URL` INTERNA, que solo resuelve dentro de
// la red de Railway. Se prefiere la PÚBLICA para que sirva desde un portátil.
const p = new PrismaClient({
  datasources: {
    db: { url: process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL },
  },
});

const PASOS = [
  [
    'Order.scheduledFor',
    `ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "scheduledFor" TIMESTAMPTZ(6)`,
  ],
  [
    'Order.clientRequestId',
    `ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "clientRequestId" TEXT`,
  ],
  [
    'índice Order (tenantId, scheduledFor)',
    // Mismo nombre que generaría Prisma para el `@@index` del esquema: así un
    // futuro diff del esquema contra la base no lo ve como «otro» índice.
    `CREATE INDEX IF NOT EXISTS "Order_tenantId_scheduledFor_idx"
       ON "Order"("tenantId", "scheduledFor")`,
  ],
  [
    'índice ÚNICO PARCIAL Order (tenantId, clientRequestId)',
    `CREATE UNIQUE INDEX IF NOT EXISTS "Order_tenantId_clientRequestId_key"
       ON "Order"("tenantId", "clientRequestId")
       WHERE "clientRequestId" IS NOT NULL`,
  ],
];

(async () => {
  const [{ n }] = await p.$queryRawUnsafe(`SELECT COUNT(*)::int AS n FROM "Order"`);
  console.log(`"Order" tiene ${n} filas.`);

  for (const [nombre, sql] of PASOS) {
    await p.$executeRawUnsafe(sql);
    console.log(`  ok · ${nombre}`);
  }

  const cols = await p.$queryRawUnsafe(`
    SELECT column_name, data_type, is_nullable FROM information_schema.columns
     WHERE table_name = 'Order' AND column_name IN ('scheduledFor', 'clientRequestId')
     ORDER BY column_name
  `);
  console.log('Columnas:', cols);
  if (cols.length !== 2) throw new Error(`esperaba 2 columnas nuevas, hay ${cols.length}`);

  const idx = await p.$queryRawUnsafe(`
    SELECT i.indexname, i.indexdef, x.indisvalid AS valido
      FROM pg_indexes i
      JOIN pg_class c ON c.relname = i.indexname
      JOIN pg_index x ON x.indexrelid = c.oid
     WHERE i.tablename = 'Order'
       AND i.indexname IN ('Order_tenantId_scheduledFor_idx', 'Order_tenantId_clientRequestId_key')
  `);
  for (const r of idx) console.log(`  ${r.indexname} · válido=${r.valido}\n    ${r.indexdef}`);
  if (idx.length !== 2 || idx.some((r) => !r.valido)) {
    throw new Error('falta un índice o quedó inválido: revísalo antes de desplegar');
  }

  // Comprobación: ningún pedido existente cambió de significado.
  const [{ agendados, conId }] = await p.$queryRawUnsafe(`
    SELECT COUNT(*) FILTER (WHERE "scheduledFor" IS NOT NULL)::int AS agendados,
           COUNT(*) FILTER (WHERE "clientRequestId" IS NOT NULL)::int AS "conId"
      FROM "Order"
  `);
  console.log(`Pedidos agendados: ${agendados} · con id de intento: ${conId} (antes del despliegue, 0 y 0).`);
  await p.$disconnect();
})().catch(async (e) => {
  console.error('ERROR:', e.message);
  await p.$disconnect();
  process.exit(1);
});
