/**
 * Migración ADITIVA del constructor visual de automatizaciones (2026-11-24).
 *
 * - AutomationWorkflow: grafo de nodos, estado draft/active/paused, filtro del
 *   disparador, re-entrada, plantilla de origen y última actividad.
 * - AutomationEnrollment: nodo actual, número de recorrido, reintentos, candado
 *   del tick, fechas y contexto del evento.
 * - AutomationStepLog (tabla nueva): historial por paso, con la clave única que
 *   impide mandar el mismo push dos veces.
 *
 * Todo es `IF NOT EXISTS` y con DEFAULT: no toca datos y se puede correr las
 * veces que haga falta. Los 5 flujos que ya existen quedan con
 * `schemaVersion = 1` y el motor los sigue leyendo como lista de pasos; solo se
 * rellena su `status` a partir de `isActive`, que es lo que ya hacían.
 *
 * Uso (desde backend/):
 *   railway run --service backend --environment production \
 *     --project ba90d94d-7e6d-4056-85ad-0e3f24e8d43a \
 *     node scripts/apply-flujos-visuales-migration.cjs
 */
const { PrismaClient } = require('@prisma/client');
// La URL PÚBLICA primero: la interna solo resuelve dentro de Railway.
const p = new PrismaClient({
  datasources: {
    db: { url: process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL },
  },
});

const SENTENCIAS = [
  // ── AutomationWorkflow ──
  `ALTER TABLE "AutomationWorkflow" ADD COLUMN IF NOT EXISTS "schemaVersion" INTEGER NOT NULL DEFAULT 1`,
  `ALTER TABLE "AutomationWorkflow" ADD COLUMN IF NOT EXISTS "graph" JSONB NOT NULL DEFAULT '{}'`,
  `ALTER TABLE "AutomationWorkflow" ADD COLUMN IF NOT EXISTS "status" TEXT NOT NULL DEFAULT 'draft'`,
  `ALTER TABLE "AutomationWorkflow" ADD COLUMN IF NOT EXISTS "triggerConfig" JSONB NOT NULL DEFAULT '{}'`,
  `ALTER TABLE "AutomationWorkflow" ADD COLUMN IF NOT EXISTS "reentry" TEXT NOT NULL DEFAULT 'once'`,
  `ALTER TABLE "AutomationWorkflow" ADD COLUMN IF NOT EXISTS "templateKey" TEXT`,
  `ALTER TABLE "AutomationWorkflow" ADD COLUMN IF NOT EXISTS "lastActivityAt" TIMESTAMP(3)`,
  // ── AutomationEnrollment ──
  `ALTER TABLE "AutomationEnrollment" ADD COLUMN IF NOT EXISTS "currentNodeId" TEXT`,
  `ALTER TABLE "AutomationEnrollment" ADD COLUMN IF NOT EXISTS "runNumber" INTEGER NOT NULL DEFAULT 1`,
  `ALTER TABLE "AutomationEnrollment" ADD COLUMN IF NOT EXISTS "attempts" INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE "AutomationEnrollment" ADD COLUMN IF NOT EXISTS "lastError" TEXT`,
  `ALTER TABLE "AutomationEnrollment" ADD COLUMN IF NOT EXISTS "lockedAt" TIMESTAMP(3)`,
  `ALTER TABLE "AutomationEnrollment" ADD COLUMN IF NOT EXISTS "enteredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP`,
  `ALTER TABLE "AutomationEnrollment" ADD COLUMN IF NOT EXISTS "completedAt" TIMESTAMP(3)`,
  `ALTER TABLE "AutomationEnrollment" ADD COLUMN IF NOT EXISTS "context" JSONB NOT NULL DEFAULT '{}'`,
  `CREATE INDEX IF NOT EXISTS "AutomationEnrollment_workflowId_status_idx" ON "AutomationEnrollment"("workflowId", "status")`,
  // ── AutomationStepLog ──
  `CREATE TABLE IF NOT EXISTS "AutomationStepLog" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "workflowId" TEXT NOT NULL,
    "enrollmentId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "runNumber" INTEGER NOT NULL DEFAULT 1,
    "nodeId" TEXT,
    "nodeType" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "message" TEXT NOT NULL DEFAULT '',
    "detail" JSONB NOT NULL DEFAULT '{}',
    "dedupKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AutomationStepLog_pkey" PRIMARY KEY ("id")
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "AutomationStepLog_dedupKey_key" ON "AutomationStepLog"("dedupKey")`,
  `CREATE INDEX IF NOT EXISTS "AutomationStepLog_enrollmentId_createdAt_idx" ON "AutomationStepLog"("enrollmentId", "createdAt")`,
  `CREATE INDEX IF NOT EXISTS "AutomationStepLog_workflowId_createdAt_idx" ON "AutomationStepLog"("workflowId", "createdAt")`,
  `CREATE INDEX IF NOT EXISTS "AutomationStepLog_tenantId_customerId_createdAt_idx" ON "AutomationStepLog"("tenantId", "customerId", "createdAt")`,
];

(async () => {
  for (const sql of SENTENCIAS) {
    await p.$executeRawUnsafe(sql);
    console.log('ok ·', sql.split('\n')[0].slice(0, 110));
  }

  // Los flujos de antes no tenían estado: se deduce de `isActive`, que es lo
  // que el motor viejo ya respetaba. Solo toca los que siguen en 'draft' Y son
  // de la versión 1, así que correrlo dos veces no pisa un estado puesto a mano.
  const n = await p.$executeRawUnsafe(`
    UPDATE "AutomationWorkflow"
       SET "status" = CASE WHEN "isActive" THEN 'active' ELSE 'paused' END
     WHERE "schemaVersion" = 1 AND "status" = 'draft'
  `);
  console.log(`\nFlujos viejos con estado rellenado: ${n}`);

  const flujos = await p.$queryRawUnsafe(
    `SELECT name, "status", "isActive", "schemaVersion" FROM "AutomationWorkflow" ORDER BY "createdAt"`,
  );
  for (const f of flujos) {
    console.log(`  ${f.name} → ${f.status} (isActive=${f.isActive}, v${f.schemaVersion})`);
  }
  await p.$disconnect();
})().catch(async (e) => {
  console.error('ERROR:', e.message);
  await p.$disconnect();
  process.exit(1);
});
