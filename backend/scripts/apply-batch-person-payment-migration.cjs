/**
 * Migración ADITIVA (2026-08-31) — flujo de pago por persona en los cortes.
 *
 * Agrega:
 *   1) PayoutBatch."receivedAt"/"receivedProofUrl"/"receivedProofMimeType"/
 *      "receivedByUserId" (marcar el dinero como RECIBIDO + comprobante).
 *   2) Tabla "BatchPersonPayment" (pago a UNA persona del corte, con comprobante).
 *
 * Idempotente: ADD COLUMN IF NOT EXISTS + CREATE TABLE IF NOT EXISTS. No borra ni
 * modifica datos. Se puede correr varias veces.
 *
 * Uso:  cd backend && railway run node scripts/apply-batch-person-payment-migration.cjs
 */
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

(async () => {
  console.log('1) Columnas de "recibido" en PayoutBatch…');
  await p.$executeRawUnsafe(`ALTER TABLE "PayoutBatch" ADD COLUMN IF NOT EXISTS "receivedAt" TIMESTAMP(3)`);
  await p.$executeRawUnsafe(`ALTER TABLE "PayoutBatch" ADD COLUMN IF NOT EXISTS "receivedProofUrl" TEXT`);
  await p.$executeRawUnsafe(`ALTER TABLE "PayoutBatch" ADD COLUMN IF NOT EXISTS "receivedProofMimeType" TEXT`);
  await p.$executeRawUnsafe(`ALTER TABLE "PayoutBatch" ADD COLUMN IF NOT EXISTS "receivedByUserId" TEXT`);

  console.log('2) Tabla BatchPersonPayment…');
  await p.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "BatchPersonPayment" (
      "id" TEXT NOT NULL,
      "batchId" TEXT NOT NULL,
      "recipientCodeId" TEXT NOT NULL,
      "amountUsd" DECIMAL(10,2) NOT NULL,
      "proofUrl" TEXT,
      "proofMimeType" TEXT,
      "reference" TEXT,
      "notes" TEXT,
      "paidAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "paidByUserId" TEXT,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "BatchPersonPayment_pkey" PRIMARY KEY ("id")
    )
  `);
  // Índice único (un pago por persona por corte) + índices de búsqueda + FK.
  await p.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "BatchPersonPayment_batchId_recipientCodeId_key" ON "BatchPersonPayment"("batchId","recipientCodeId")`);
  await p.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "BatchPersonPayment_batchId_idx" ON "BatchPersonPayment"("batchId")`);
  await p.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "BatchPersonPayment_recipientCodeId_idx" ON "BatchPersonPayment"("recipientCodeId")`);
  // FK con cascade (idempotente: solo si no existe).
  await p.$executeRawUnsafe(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'BatchPersonPayment_batchId_fkey') THEN
        ALTER TABLE "BatchPersonPayment"
          ADD CONSTRAINT "BatchPersonPayment_batchId_fkey"
          FOREIGN KEY ("batchId") REFERENCES "PayoutBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
      END IF;
    END $$;
  `);

  const cols = await p.$queryRawUnsafe(`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'PayoutBatch' AND column_name LIKE 'received%'
    ORDER BY column_name
  `);
  const tbl = await p.$queryRawUnsafe(`SELECT table_name FROM information_schema.tables WHERE table_name = 'BatchPersonPayment'`);
  console.log('\nResultado:');
  console.log('  PayoutBatch.received*:', cols.map((c) => c.column_name).join(', ') || '(ninguna)');
  console.log('  Tabla BatchPersonPayment:', tbl.length ? 'creada ✓' : 'NO creada');
  console.log('\nListo.');
  await p.$disconnect();
})().catch(async (e) => {
  console.error('ERROR:', e.message);
  await p.$disconnect();
  process.exit(1);
});
