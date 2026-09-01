/**
 * Migración ADITIVA (2026-08-31) — Contabilidad Fase 5: tabla FinancialClose
 * (cierre contable mensual = snapshot congelado de la cascada de utilidad).
 *
 * Idempotente: CREATE TABLE IF NOT EXISTS + índices IF NOT EXISTS. No borra nada.
 *
 * Uso:  cd backend && railway run node scripts/apply-financial-close-migration.cjs
 */
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

(async () => {
  console.log('Creando tabla FinancialClose…');
  await p.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "FinancialClose" (
      "id" TEXT NOT NULL,
      "period" TEXT NOT NULL,
      "scope" TEXT NOT NULL DEFAULT 'clubify',
      "grossUsd" DECIMAL(12,2) NOT NULL,
      "feeTaxUsd" DECIMAL(12,2) NOT NULL,
      "netUsd" DECIMAL(12,2) NOT NULL,
      "egresosUsd" DECIMAL(12,2) NOT NULL,
      "nominaUsd" DECIMAL(12,2) NOT NULL,
      "comisionesUsd" DECIMAL(12,2) NOT NULL,
      "utilidadUsd" DECIMAL(12,2) NOT NULL,
      "note" TEXT,
      "closedByUserId" TEXT,
      "closedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "FinancialClose_pkey" PRIMARY KEY ("id")
    )
  `);
  await p.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "FinancialClose_period_scope_key" ON "FinancialClose"("period","scope")`);
  await p.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "FinancialClose_period_idx" ON "FinancialClose"("period")`);

  const t = await p.$queryRawUnsafe(`SELECT table_name FROM information_schema.tables WHERE table_name = 'FinancialClose'`);
  console.log('Tabla FinancialClose:', t.length ? 'creada ✓' : 'NO creada');
  console.log('Listo.');
  await p.$disconnect();
})().catch(async (e) => {
  console.error('ERROR:', e.message);
  await p.$disconnect();
  process.exit(1);
});
