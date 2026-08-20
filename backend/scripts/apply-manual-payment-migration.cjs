/**
 * Migración ADITIVA: pagos por fuera de las pasarelas (Nequi, efectivo…).
 *
 *  - `Tenant.manualPayment` (boolean, default false)
 *  - tabla `ManualPayment` con sus índices
 *
 * Aditiva e idempotente: `ADD COLUMN IF NOT EXISTS` sobre una columna con
 * default, y `CREATE TABLE/INDEX IF NOT EXISTS`. No toca datos existentes y se
 * puede correr las veces que haga falta. NUNCA usar `prisma db push` contra
 * producción.
 *
 * Uso:  railway run node scripts/apply-manual-payment-migration.cjs
 */
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

(async () => {
  console.log('1) Tenant."manualPayment"…');
  await p.$executeRawUnsafe(
    `ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "manualPayment" BOOLEAN NOT NULL DEFAULT false`,
  );

  console.log('2) Tabla "ManualPayment"…');
  await p.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "ManualPayment" (
      "id"           TEXT PRIMARY KEY,
      "tenantId"     TEXT NOT NULL,
      "whiteLabelId" TEXT,
      "method"       TEXT NOT NULL,
      "amount"       DECIMAL(10,2),
      "currency"     TEXT,
      "reference"    TEXT,
      "note"         TEXT,
      "paidAt"       TIMESTAMP(3) NOT NULL,
      "periodStart"  TIMESTAMP(3) NOT NULL,
      "periodEnd"    TIMESTAMP(3) NOT NULL,
      "periodicity"  TEXT,
      "actorId"      TEXT,
      "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);

  // Sin claves foráneas a propósito: es un registro contable. Si un negocio se
  // borra, el rastro de lo que se le cobró debe sobrevivir.
  for (const [nombre, cols] of [
    ['ManualPayment_tenantId_paidAt_idx', '"tenantId", "paidAt"'],
    ['ManualPayment_whiteLabelId_paidAt_idx', '"whiteLabelId", "paidAt"'],
    ['ManualPayment_periodEnd_idx', '"periodEnd"'],
  ]) {
    await p.$executeRawUnsafe(
      `CREATE INDEX IF NOT EXISTS "${nombre}" ON "ManualPayment" (${cols})`,
    );
  }

  const col = await p.$queryRawUnsafe(`
    SELECT column_name, data_type, column_default, is_nullable
      FROM information_schema.columns
     WHERE table_name = 'Tenant' AND column_name = 'manualPayment'`);
  console.log('\nTenant.manualPayment →', col[0] ?? '(no se creó)');

  const cols = await p.$queryRawUnsafe(`
    SELECT column_name FROM information_schema.columns
     WHERE table_name = 'ManualPayment' ORDER BY ordinal_position`);
  console.log(`ManualPayment → ${cols.length} columnas: ${cols.map((c) => c.column_name).join(', ')}`);

  const idx = await p.$queryRawUnsafe(
    `SELECT indexname FROM pg_indexes WHERE tablename = 'ManualPayment' ORDER BY indexname`,
  );
  console.log(`Índices → ${idx.map((i) => i.indexname).join(', ')}`);

  // Comprobación de que no se tocó a nadie: nadie nace marcado.
  const [n] = await p.$queryRawUnsafe(
    `SELECT COUNT(*)::int AS n FROM "Tenant" WHERE "manualPayment" = true`,
  );
  console.log(`\nNegocios marcados como pago manual: ${n.n} (debe ser 0 tras migrar)`);
  console.log('Listo. Nada más de la base fue tocado.');

  await p.$disconnect();
})().catch(async (e) => {
  console.error('FALLÓ:', e.message);
  await p.$disconnect();
  process.exit(1);
});
