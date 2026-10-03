/**
 * Migración ADITIVA: `IncomeRecord.payerWhiteLabelId` (la marca blanca que le
 * pagó el ingreso a la plataforma) y su índice.
 *
 * Aditiva e idempotente (`ADD COLUMN IF NOT EXISTS`, `CREATE INDEX IF NOT
 * EXISTS`): columna nullable, no toca datos. Se puede correr varias veces.
 *
 * Uso:  railway run --service Postgres-Nq8w node scripts/apply-income-payer-migration.cjs
 */
const { PrismaClient } = require('@prisma/client');
// La URL interna de `railway run` solo resuelve dentro de Railway.
const p = new PrismaClient({
  datasources: { db: { url: process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL } },
});

(async () => {
  await p.$executeRawUnsafe(
    `ALTER TABLE "IncomeRecord" ADD COLUMN IF NOT EXISTS "payerWhiteLabelId" TEXT`,
  );
  await p.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS "IncomeRecord_payerWhiteLabelId_idx" ON "IncomeRecord"("payerWhiteLabelId")`,
  );
  const r = await p.$queryRawUnsafe(`
    SELECT column_name, data_type, is_nullable FROM information_schema.columns
    WHERE table_name = 'IncomeRecord' AND column_name = 'payerWhiteLabelId'
  `);
  console.log('Resultado:', r[0] || '(no se creó)');
  await p.$disconnect();
})().catch(async (e) => {
  console.error('ERROR:', e.message);
  await p.$disconnect();
  process.exit(1);
});
