/**
 * Migración ADITIVA del Reporte de comisiones (/reporte-comisiones).
 *
 * Crea tres tablas nuevas, sin tocar ninguna existente:
 *   · "CommissionNote"      — notas y comprobantes de una comisión (se anulan, no se borran).
 *   · "CommissionAuditLog"  — bitácora de cambios hechos desde el reporte (solo escritura).
 *   · "CommissionManual"    — datos de las comisiones creadas con «+ Nueva comisión».
 *
 * Ninguna lleva clave foránea a "Commission": así no hay que tocar esa tabla, que
 * es la del motor de cálculo, y un borrado allí no se lleva el rastro de auditoría.
 *
 * Aditiva e idempotente: `CREATE TABLE IF NOT EXISTS` + `CREATE INDEX IF NOT
 * EXISTS`. Se puede correr varias veces sin efecto. NO usar `prisma db push`.
 *
 * Uso:  railway run node scripts/apply-reporte-comisiones-migration.cjs
 */
const { PrismaClient } = require('@prisma/client');
// `railway run` inyecta la URL INTERNA, que solo resuelve dentro de Railway; se
// prefiere la PÚBLICA para que el script sirva también desde un portátil.
const p = new PrismaClient({
  datasources: {
    db: { url: process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL },
  },
});

const SENTENCIAS = [
  `CREATE TABLE IF NOT EXISTS "CommissionNote" (
    "id" TEXT NOT NULL,
    "commissionId" TEXT NOT NULL,
    "texto" TEXT NOT NULL,
    "adjuntoUrl" TEXT,
    "adjuntoMime" TEXT,
    "autorUserId" TEXT,
    "autorNombre" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "anuladaEl" TIMESTAMP(3),
    "anuladaPorUserId" TEXT,
    "motivoAnulacion" TEXT,
    CONSTRAINT "CommissionNote_pkey" PRIMARY KEY ("id")
  )`,
  `CREATE INDEX IF NOT EXISTS "CommissionNote_commissionId_createdAt_idx"
    ON "CommissionNote" ("commissionId", "createdAt")`,

  `CREATE TABLE IF NOT EXISTS "CommissionAuditLog" (
    "id" TEXT NOT NULL,
    "commissionId" TEXT,
    "recipientCodeId" TEXT,
    "batchId" TEXT,
    "accion" TEXT NOT NULL,
    "motivo" TEXT NOT NULL,
    "valorAnterior" JSONB,
    "valorNuevo" JSONB,
    "actorUserId" TEXT,
    "actorEmail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CommissionAuditLog_pkey" PRIMARY KEY ("id")
  )`,
  `CREATE INDEX IF NOT EXISTS "CommissionAuditLog_commissionId_createdAt_idx"
    ON "CommissionAuditLog" ("commissionId", "createdAt")`,
  `CREATE INDEX IF NOT EXISTS "CommissionAuditLog_recipientCodeId_createdAt_idx"
    ON "CommissionAuditLog" ("recipientCodeId", "createdAt")`,
  `CREATE INDEX IF NOT EXISTS "CommissionAuditLog_createdAt_idx"
    ON "CommissionAuditLog" ("createdAt")`,

  `CREATE TABLE IF NOT EXISTS "CommissionManual" (
    "id" TEXT NOT NULL,
    "commissionId" TEXT NOT NULL,
    "claveIdempotencia" TEXT NOT NULL,
    "ownerTenantId" TEXT,
    "incomeRecordId" TEXT,
    "tipo" TEXT NOT NULL,
    "baseUsd" DECIMAL(10,2) NOT NULL,
    "porcentaje" DECIMAL(5,2),
    "montoFijoUsd" DECIMAL(10,2),
    "descripcion" TEXT NOT NULL,
    "estadoInicial" TEXT NOT NULL,
    "creadoPorUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CommissionManual_pkey" PRIMARY KEY ("id")
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "CommissionManual_commissionId_key"
    ON "CommissionManual" ("commissionId")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "CommissionManual_claveIdempotencia_key"
    ON "CommissionManual" ("claveIdempotencia")`,
  `CREATE INDEX IF NOT EXISTS "CommissionManual_ownerTenantId_idx"
    ON "CommissionManual" ("ownerTenantId")`,
  `CREATE INDEX IF NOT EXISTS "CommissionManual_incomeRecordId_idx"
    ON "CommissionManual" ("incomeRecordId")`,
];

(async () => {
  for (const sql of SENTENCIAS) {
    const titulo = sql.trim().split('\n')[0].replace(/\s+/g, ' ').slice(0, 90);
    await p.$executeRawUnsafe(sql);
    console.log('  ok ·', titulo);
  }

  const tablas = await p.$queryRawUnsafe(`
    SELECT table_name FROM information_schema.tables
    WHERE table_name IN ('CommissionNote', 'CommissionAuditLog', 'CommissionManual')
    ORDER BY table_name
  `);
  console.log('\nTablas presentes:', tablas.map((t) => t.table_name).join(', '));
  if (tablas.length !== 3) {
    console.error('Faltan tablas: revisa el error de arriba.');
    process.exitCode = 1;
  }
  await p.$disconnect();
})().catch(async (e) => {
  console.error('ERROR:', e.message);
  await p.$disconnect();
  process.exit(1);
});
