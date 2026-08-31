// CONTABILIDAD — Fase 3. Migración ADITIVA e idempotente para Nómina:
// PayrollEmployee + PayrollRun + PayrollItem + enum PayrollStatus. No toca nada
// existente. NUNCA `prisma db push`.
//
//   cd backend
//   export DATABASE_PUBLIC_URL="$(railway variables --service Postgres-Nq8w --json \
//     | python3 -c 'import json,sys;print(json.load(sys.stdin)["DATABASE_PUBLIC_URL"])')"
//   node scripts/apply-payroll-migration.cjs
const { PrismaClient } = require('@prisma/client');
const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
const p = new PrismaClient({ datasources: { db: { url } } });

(async () => {
  await p.$executeRawUnsafe(`
    DO $$ BEGIN
      CREATE TYPE "PayrollStatus" AS ENUM ('PENDING', 'PARTIAL', 'PAID');
    EXCEPTION WHEN duplicate_object THEN null;
    END $$;`);
  console.log('✔ enum PayrollStatus listo');

  await p.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "PayrollEmployee" (
      "id"           TEXT PRIMARY KEY,
      "name"         TEXT NOT NULL,
      "role"         TEXT,
      "payType"      TEXT,
      "amountUsd"    DECIMAL(12,2) NOT NULL,
      "periodicity"  TEXT NOT NULL,
      "active"       BOOLEAN NOT NULL DEFAULT true,
      "whiteLabelId" TEXT,
      "note"         TEXT,
      "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    );`);
  console.log('✔ tabla PayrollEmployee lista');

  await p.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "PayrollRun" (
      "id"            TEXT PRIMARY KEY,
      "code"          TEXT,
      "periodLabel"   TEXT NOT NULL,
      "periodStart"   TIMESTAMP(3),
      "periodEnd"     TIMESTAMP(3),
      "totalUsd"      DECIMAL(12,2) NOT NULL DEFAULT 0,
      "amountPaidUsd" DECIMAL(12,2) NOT NULL DEFAULT 0,
      "status"        "PayrollStatus" NOT NULL DEFAULT 'PENDING',
      "method"        TEXT,
      "account"       TEXT,
      "reference"     TEXT,
      "receiptUrl"    TEXT,
      "note"          TEXT,
      "expenseId"     TEXT,
      "whiteLabelId"  TEXT,
      "actorId"       TEXT,
      "paidAt"        TIMESTAMP(3),
      "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    );`);
  console.log('✔ tabla PayrollRun lista');

  await p.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "PayrollItem" (
      "id"           TEXT PRIMARY KEY,
      "runId"        TEXT NOT NULL,
      "employeeId"   TEXT,
      "employeeName" TEXT NOT NULL,
      "role"         TEXT,
      "baseUsd"      DECIMAL(12,2) NOT NULL,
      "bonusUsd"     DECIMAL(12,2) NOT NULL DEFAULT 0,
      "deductionUsd" DECIMAL(12,2) NOT NULL DEFAULT 0,
      "totalUsd"     DECIMAL(12,2) NOT NULL,
      "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "PayrollItem_runId_fkey" FOREIGN KEY ("runId")
        REFERENCES "PayrollRun"("id") ON DELETE CASCADE
    );`);
  console.log('✔ tabla PayrollItem lista');

  const idx = [
    `CREATE INDEX IF NOT EXISTS "PayrollEmployee_active_idx" ON "PayrollEmployee" ("active");`,
    `CREATE INDEX IF NOT EXISTS "PayrollRun_status_idx" ON "PayrollRun" ("status");`,
    `CREATE INDEX IF NOT EXISTS "PayrollRun_createdAt_idx" ON "PayrollRun" ("createdAt");`,
    `CREATE INDEX IF NOT EXISTS "PayrollItem_runId_idx" ON "PayrollItem" ("runId");`,
  ];
  for (const q of idx) await p.$executeRawUnsafe(q);
  console.log('✔ índices listos');

  const c = await p.payrollEmployee.count().catch(() => 'N/A');
  console.log(`\n✅ Migración Nómina aplicada. PayrollEmployee: ${c} filas.`);
})()
  .catch((e) => {
    console.error('❌ Falló la migración:', e.message);
    process.exit(1);
  })
  .finally(() => p.$disconnect());
