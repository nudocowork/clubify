/**
 * Migración ADITIVA: crea la tabla `ManualPaymentRequest` (pagos por fuera que
 * registran los closers y que un admin aprueba).
 *
 * Aditiva e idempotente: `CREATE TABLE IF NOT EXISTS` y `CREATE INDEX IF NOT
 * EXISTS`. No toca ninguna tabla existente y se puede correr varias veces.
 * Nunca `prisma db push` contra producción: borraría los índices parciales que
 * Prisma no sabe expresar.
 *
 * Uso:  railway run --service Postgres-Nq8w node scripts/apply-manual-payment-request-migration.cjs
 */
const { PrismaClient } = require('@prisma/client');
// `railway run` inyecta la URL INTERNA, que solo resuelve dentro de Railway:
// se prefiere la pública para que funcione desde un portátil.
const p = new PrismaClient({
  datasources: {
    db: { url: process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL },
  },
});

(async () => {
  await p.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "ManualPaymentRequest" (
      "id"                   TEXT NOT NULL,
      "referralCodeId"       TEXT NOT NULL,
      "closerName"           TEXT NOT NULL,
      "whiteLabelId"         TEXT,
      "status"               TEXT NOT NULL DEFAULT 'PENDIENTE',
      "brandName"            TEXT NOT NULL,
      "ownerEmail"           TEXT NOT NULL,
      "ownerPhone"           TEXT,
      "ownerFullName"        TEXT NOT NULL,
      "planPeriodicity"      TEXT NOT NULL,
      "businessType"         TEXT NOT NULL DEFAULT 'FULL',
      "businessCategorySlug" TEXT,
      "method"               TEXT NOT NULL,
      "amount"               DECIMAL(12,2) NOT NULL,
      "currency"             TEXT NOT NULL DEFAULT 'USD',
      "paidAt"               TIMESTAMP(3) NOT NULL,
      "reference"            TEXT,
      "proofUrl"             TEXT NOT NULL,
      "note"                 TEXT,
      "amountUsd"            DECIMAL(10,2),
      "createdTenantId"      TEXT,
      "reviewedById"         TEXT,
      "reviewedAt"           TIMESTAMP(3),
      "rejectReason"         TEXT,
      "lastError"            TEXT,
      "createdAt"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt"            TIMESTAMP(3) NOT NULL,
      CONSTRAINT "ManualPaymentRequest_pkey" PRIMARY KEY ("id")
    )
  `);
  await p.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS "ManualPaymentRequest_status_createdAt_idx" ON "ManualPaymentRequest"("status", "createdAt")`,
  );
  await p.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS "ManualPaymentRequest_referralCodeId_idx" ON "ManualPaymentRequest"("referralCodeId")`,
  );
  await p.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS "ManualPaymentRequest_whiteLabelId_idx" ON "ManualPaymentRequest"("whiteLabelId")`,
  );

  const cols = await p.$queryRawUnsafe(`
    SELECT count(*)::int AS n FROM information_schema.columns
    WHERE table_name = 'ManualPaymentRequest'
  `);
  const filas = await p.$queryRawUnsafe(
    `SELECT count(*)::int AS n FROM "ManualPaymentRequest"`,
  );
  console.log(
    `ManualPaymentRequest: ${cols[0].n} columnas (esperadas 27), ${filas[0].n} solicitudes.`,
  );
  await p.$disconnect();
})().catch(async (e) => {
  console.error('ERROR:', e.message);
  await p.$disconnect();
  process.exit(1);
});
