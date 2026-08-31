// CONTABILIDAD — Fase 1. Migración ADITIVA e idempotente para IncomeRecord.
// Crea la tabla del histórico de ingreso real por transacción (bruto/fee/
// impuesto/neto) + el enum IncomeReconStatus + índices, y siembra las tasas
// configurables (fee por pasarela + impuesto). NO toca ninguna tabla existente,
// NO recalcula histórico. NUNCA `prisma db push`/`migrate diff` a prod.
//
//   cd backend
//   export DATABASE_PUBLIC_URL="$(railway variables --service Postgres-Nq8w --json \
//     | python3 -c 'import json,sys;print(json.load(sys.stdin)["DATABASE_PUBLIC_URL"])')"
//   node scripts/apply-income-record-migration.cjs
//
// Idempotente: se puede correr varias veces sin efecto. Verifica al final.
const { PrismaClient } = require('@prisma/client');
const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
const p = new PrismaClient({ datasources: { db: { url } } });

// Tasas por defecto (editables luego en Settings desde el panel). El dueño
// definió fee de pasarela 8,6% e impuesto 19%. Manual (efectivo) sin fee.
const RATE_SETTINGS = [
  ['finance.gatewayFeePct.HOTMART', '8.6'],
  ['finance.gatewayFeePct.STRIPE', '3.5'],
  ['finance.gatewayFeePct.CROSS', '5'],
  ['finance.gatewayFeePct.MERCADOPAGO', '4'],
  ['finance.gatewayFeePct.MANUAL', '0'],
  ['finance.taxPct', '19'],
  // 'gross' = impuesto sobre la venta bruta · 'included' = IVA incluido en el precio.
  ['finance.taxBase', 'gross'],
];

(async () => {
  // 1) Enum IncomeReconStatus (Postgres no tiene CREATE TYPE IF NOT EXISTS →
  //    guard con DO/EXCEPTION para que sea idempotente).
  await p.$executeRawUnsafe(`
    DO $$ BEGIN
      CREATE TYPE "IncomeReconStatus" AS ENUM ('PENDING', 'RECONCILED', 'REVIEW');
    EXCEPTION WHEN duplicate_object THEN null;
    END $$;`);
  console.log('✔ enum IncomeReconStatus listo');

  // 2) Tabla IncomeRecord (usa el enum existente "PaymentGateway"). Nombres de
  //    columna EXACTOS a los campos del modelo Prisma (camelCase, sin @map).
  await p.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "IncomeRecord" (
      "id"               TEXT PRIMARY KEY,
      "gateway"          "PaymentGateway" NOT NULL,
      "externalTxId"     TEXT NOT NULL,
      "tenantId"         TEXT,
      "whiteLabelId"     TEXT,
      "brandName"        TEXT,
      "planId"           TEXT,
      "planPeriodicity"  TEXT,
      "productName"      TEXT,
      "currency"         TEXT NOT NULL DEFAULT 'USD',
      "grossUsd"         DECIMAL(10,2) NOT NULL,
      "gatewayFeeUsd"    DECIMAL(10,2) NOT NULL DEFAULT 0,
      "taxUsd"           DECIMAL(10,2) NOT NULL DEFAULT 0,
      "otherDiscountUsd" DECIMAL(10,2) NOT NULL DEFAULT 0,
      "netExpectedUsd"   DECIMAL(10,2) NOT NULL,
      "netReceivedUsd"   DECIMAL(10,2),
      "isFirstPayment"   BOOLEAN NOT NULL DEFAULT false,
      "periodKey"        TEXT,
      "saleDate"         TIMESTAMP(3) NOT NULL,
      "receivedDate"     TIMESTAMP(3),
      "reconStatus"      "IncomeReconStatus" NOT NULL DEFAULT 'PENDING',
      "reconciledBy"     TEXT,
      "reconciledAt"     TIMESTAMP(3),
      "note"             TEXT,
      "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    );`);
  console.log('✔ tabla IncomeRecord lista');

  // 3) Índices (incluido el único de dedup por transacción).
  const idx = [
    `CREATE UNIQUE INDEX IF NOT EXISTS "IncomeRecord_gateway_externalTxId_key" ON "IncomeRecord" ("gateway", "externalTxId");`,
    `CREATE INDEX IF NOT EXISTS "IncomeRecord_tenantId_idx" ON "IncomeRecord" ("tenantId");`,
    `CREATE INDEX IF NOT EXISTS "IncomeRecord_whiteLabelId_saleDate_idx" ON "IncomeRecord" ("whiteLabelId", "saleDate");`,
    `CREATE INDEX IF NOT EXISTS "IncomeRecord_periodKey_idx" ON "IncomeRecord" ("periodKey");`,
    `CREATE INDEX IF NOT EXISTS "IncomeRecord_reconStatus_idx" ON "IncomeRecord" ("reconStatus");`,
    `CREATE INDEX IF NOT EXISTS "IncomeRecord_saleDate_idx" ON "IncomeRecord" ("saleDate");`,
  ];
  for (const q of idx) await p.$executeRawUnsafe(q);
  console.log('✔ índices listos');

  // 4) Seed de tasas (upsert idempotente; NO pisa un value ajustado a mano).
  for (const [key, value] of RATE_SETTINGS) {
    const existing = await p.setting.findUnique({ where: { key } });
    if (existing) {
      console.log(`  = ${key} ya existe = "${existing.value}" (no lo toco)`);
    } else {
      await p.setting.create({ data: { key, value } });
      console.log(`  + ${key} = "${value}"`);
    }
  }

  // 5) Verificación.
  const cols = await p.$queryRawUnsafe(
    `SELECT column_name FROM information_schema.columns WHERE table_name = 'IncomeRecord' ORDER BY ordinal_position;`,
  );
  console.log(`\nVerificación: IncomeRecord tiene ${cols.length} columnas.`);
  const count = await p.incomeRecord.count().catch(() => 'N/A (regenerar prisma client)');
  console.log(`Filas actuales: ${count}`);
  console.log('\n✅ Migración IncomeRecord aplicada (aditiva, idempotente).');
})()
  .catch((e) => {
    console.error('❌ Falló la migración:', e.message);
    process.exit(1);
  })
  .finally(() => p.$disconnect());
