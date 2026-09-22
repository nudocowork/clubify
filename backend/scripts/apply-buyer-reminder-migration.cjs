/**
 * Migración ADITIVA: recordatorios al comprador que pagó y no creó su cuenta.
 *
 *  - PendingHotmartPayment."whiteLabelId": la marca del webhook. La tabla no
 *    la guardaba, y un recordatorio sin marca saldría con la de Clubify a un
 *    comprador de otra marca.
 *  - PendingHotmartPayment / PendingStripePayment ."buyerReminder1At",
 *    ."buyerReminder2At" y ."buyerReminder3At": los recordatorios de los
 *    30 min, 24 h y 48 h. Son el candado que impide mandar el mismo
 *    recordatorio dos veces. El 3 se añadió después (mismo día): el script es
 *    idempotente y se vuelve a correr entero.
 *
 * Aditiva e idempotente: `ADD COLUMN IF NOT EXISTS` sobre columnas nullable.
 * No toca datos existentes y se puede correr varias veces sin efecto. Hay que
 * aplicarla ANTES de desplegar el backend: el cron las lee cada 10 minutos.
 *
 * Uso:  railway run --service backend --environment production node scripts/apply-buyer-reminder-migration.cjs
 */
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

const COLUMNAS = [
  ['PendingHotmartPayment', 'whiteLabelId', 'TEXT'],
  ['PendingHotmartPayment', 'buyerReminder1At', 'TIMESTAMP(3)'],
  ['PendingHotmartPayment', 'buyerReminder2At', 'TIMESTAMP(3)'],
  ['PendingHotmartPayment', 'buyerReminder3At', 'TIMESTAMP(3)'],
  ['PendingStripePayment', 'buyerReminder1At', 'TIMESTAMP(3)'],
  ['PendingStripePayment', 'buyerReminder2At', 'TIMESTAMP(3)'],
  ['PendingStripePayment', 'buyerReminder3At', 'TIMESTAMP(3)'],
];

(async () => {
  for (const [tabla, columna, tipo] of COLUMNAS) {
    await p.$executeRawUnsafe(
      `ALTER TABLE "${tabla}" ADD COLUMN IF NOT EXISTS "${columna}" ${tipo}`,
    );
  }
  await p.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS "PendingHotmartPayment_whiteLabelId_idx" ON "PendingHotmartPayment"("whiteLabelId")`,
  );

  const hay = await p.$queryRawUnsafe(`
    SELECT table_name, column_name, data_type, is_nullable
      FROM information_schema.columns
     WHERE table_schema = 'public' AND (
           (table_name = 'PendingHotmartPayment' AND column_name IN ('whiteLabelId','buyerReminder1At','buyerReminder2At','buyerReminder3At'))
        OR (table_name = 'PendingStripePayment' AND column_name IN ('buyerReminder1At','buyerReminder2At','buyerReminder3At')))
     ORDER BY table_name, column_name
  `);
  for (const c of hay) {
    console.log(`  ${c.table_name}.${c.column_name} → ${c.data_type}, nullable=${c.is_nullable}`);
  }
  if (hay.length !== COLUMNAS.length) {
    throw new Error(`Esperaba ${COLUMNAS.length} columnas y hay ${hay.length}`);
  }
  console.log('Migración aplicada.');
  await p.$disconnect();
})().catch(async (e) => {
  console.error('ERROR:', e.message);
  await p.$disconnect();
  process.exit(1);
});
