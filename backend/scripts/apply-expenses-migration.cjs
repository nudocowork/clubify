// CONTABILIDAD — Fase 2. Migración ADITIVA e idempotente para Egresos:
// ExpenseCategory + Expense + RecurringExpense + enum ExpenseStatus. Siembra
// las categorías base. No toca ninguna tabla existente. NUNCA `prisma db push`.
//
//   cd backend
//   export DATABASE_PUBLIC_URL="$(railway variables --service Postgres-Nq8w --json \
//     | python3 -c 'import json,sys;print(json.load(sys.stdin)["DATABASE_PUBLIC_URL"])')"
//   node scripts/apply-expenses-migration.cjs
const { PrismaClient } = require('@prisma/client');
const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
const p = new PrismaClient({ datasources: { db: { url } } });

const CATEGORIES = [
  ['Nómina', 'nomina', '#7C3AED'],
  ['Comisiones', 'comisiones', '#6366F1'],
  ['Publicidad', 'publicidad', '#2563EB'],
  ['Software', 'software', '#0EA5E9'],
  ['Servidores', 'servidores', '#64748B'],
  ['APIs', 'apis', '#0891B2'],
  ['Honorarios', 'honorarios', '#DB2777'],
  ['Impuestos', 'impuestos', '#DC2626'],
  ['Fee pasarela', 'fee-pasarela', '#F97316'],
  ['Oficina', 'oficina', '#CA8A04'],
  ['Servicios', 'servicios', '#16A34A'],
  ['Diseño', 'diseno', '#A855F7'],
  ['Desarrollo', 'desarrollo', '#4F46E5'],
  ['Soporte', 'soporte', '#059669'],
  ['Reembolsos', 'reembolsos', '#EF4444'],
  ['Operación', 'operacion', '#0D9488'],
  ['Otros', 'otros', '#6B7280'],
];

(async () => {
  // Enum ExpenseStatus (idempotente).
  await p.$executeRawUnsafe(`
    DO $$ BEGIN
      CREATE TYPE "ExpenseStatus" AS ENUM ('PENDING', 'REVIEW', 'PARTIAL', 'PAID');
    EXCEPTION WHEN duplicate_object THEN null;
    END $$;`);
  console.log('✔ enum ExpenseStatus listo');

  await p.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "ExpenseCategory" (
      "id"        TEXT PRIMARY KEY,
      "name"      TEXT NOT NULL,
      "slug"      TEXT NOT NULL UNIQUE,
      "color"     TEXT,
      "active"    BOOLEAN NOT NULL DEFAULT true,
      "sortOrder" INTEGER NOT NULL DEFAULT 0,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    );`);
  console.log('✔ tabla ExpenseCategory lista');

  await p.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "Expense" (
      "id"            TEXT PRIMARY KEY,
      "concept"       TEXT NOT NULL,
      "categoryId"    TEXT,
      "supplier"      TEXT,
      "amountUsd"     DECIMAL(12,2) NOT NULL,
      "currency"      TEXT NOT NULL DEFAULT 'USD',
      "method"        TEXT,
      "account"       TEXT,
      "status"        "ExpenseStatus" NOT NULL DEFAULT 'PENDING',
      "amountPaidUsd" DECIMAL(12,2) NOT NULL DEFAULT 0,
      "receiptUrl"    TEXT,
      "note"          TEXT,
      "pctRate"       DECIMAL(6,3),
      "pctBase"       DECIMAL(12,2),
      "recurringId"   TEXT,
      "payoutBatchId" TEXT,
      "expenseDate"   TIMESTAMP(3) NOT NULL,
      "whiteLabelId"  TEXT,
      "actorId"       TEXT,
      "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    );`);
  console.log('✔ tabla Expense lista');

  await p.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "RecurringExpense" (
      "id"           TEXT PRIMARY KEY,
      "concept"      TEXT NOT NULL,
      "categoryId"   TEXT,
      "supplier"     TEXT,
      "amountUsd"    DECIMAL(12,2) NOT NULL,
      "periodicity"  TEXT NOT NULL,
      "method"       TEXT,
      "account"      TEXT,
      "active"       BOOLEAN NOT NULL DEFAULT true,
      "nextDueDate"  TIMESTAMP(3),
      "whiteLabelId" TEXT,
      "note"         TEXT,
      "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    );`);
  console.log('✔ tabla RecurringExpense lista');

  const idx = [
    `CREATE INDEX IF NOT EXISTS "Expense_whiteLabelId_expenseDate_idx" ON "Expense" ("whiteLabelId", "expenseDate");`,
    `CREATE INDEX IF NOT EXISTS "Expense_categoryId_idx" ON "Expense" ("categoryId");`,
    `CREATE INDEX IF NOT EXISTS "Expense_status_idx" ON "Expense" ("status");`,
    `CREATE INDEX IF NOT EXISTS "Expense_expenseDate_idx" ON "Expense" ("expenseDate");`,
    `CREATE INDEX IF NOT EXISTS "RecurringExpense_active_nextDueDate_idx" ON "RecurringExpense" ("active", "nextDueDate");`,
  ];
  for (const q of idx) await p.$executeRawUnsafe(q);
  console.log('✔ índices listos');

  // Seed de categorías (idempotente por slug único).
  let n = 0;
  for (let i = 0; i < CATEGORIES.length; i++) {
    const [name, slug, color] = CATEGORIES[i];
    const existing = await p.expenseCategory.findUnique({ where: { slug } });
    if (!existing) {
      await p.expenseCategory.create({ data: { name, slug, color, sortOrder: i } });
      n++;
    }
  }
  console.log(`✔ categorías: ${n} nuevas (de ${CATEGORIES.length})`);

  const c = await p.expenseCategory.count();
  console.log(`\n✅ Migración Egresos aplicada. ExpenseCategory: ${c} filas.`);
})()
  .catch((e) => {
    console.error('❌ Falló la migración:', e.message);
    process.exit(1);
  })
  .finally(() => p.$disconnect());
