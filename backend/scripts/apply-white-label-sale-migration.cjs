/**
 * Migración ADITIVA: tabla `WhiteLabelSale` (la venta de cada marca blanca:
 * precio total, cuotas, frecuencia, estado). Idempotente.
 *
 * Uso: railway run --service Postgres-Nq8w node scripts/apply-white-label-sale-migration.cjs
 */
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient({
  datasources: { db: { url: process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL } },
});
(async () => {
  await p.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "WhiteLabelSale" (
      "id"           TEXT NOT NULL,
      "whiteLabelId" TEXT NOT NULL,
      "totalUsd"     DECIMAL(10,2),
      "cuotas"       INTEGER NOT NULL DEFAULT 1,
      "frecuencia"   TEXT NOT NULL DEFAULT 'MENSUAL',
      "primeraCuota" TIMESTAMP(3),
      "estado"       TEXT NOT NULL DEFAULT 'ACTIVA',
      "nota"         TEXT,
      "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt"    TIMESTAMP(3) NOT NULL,
      CONSTRAINT "WhiteLabelSale_pkey" PRIMARY KEY ("id")
    )`);
  await p.$executeRawUnsafe(
    `CREATE UNIQUE INDEX IF NOT EXISTS "WhiteLabelSale_whiteLabelId_key" ON "WhiteLabelSale"("whiteLabelId")`,
  );
  const n = await p.$queryRawUnsafe(`SELECT count(*)::int n FROM information_schema.columns WHERE table_name='WhiteLabelSale'`);
  console.log(`WhiteLabelSale: ${n[0].n} columnas (esperadas 10).`);
  await p.$disconnect();
})().catch(async (e) => {
  console.error('ERROR:', e.message);
  await p.$disconnect();
  process.exit(1);
});
