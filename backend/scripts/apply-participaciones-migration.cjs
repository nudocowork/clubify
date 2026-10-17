/**
 * Migración ADITIVA: participaciones globales y reglas de comisión por
 * colaborador (2026-10-17).
 *
 *   · Tabla  "ParticipacionGlobal"        — «X cobra Y sobre las ventas de Clubify».
 *   · Tabla  "ReglaComisionColaborador"   — fija / nueva vs renovación / periodicidad / plan.
 *   · Tabla  "ReglaDeComisionHistorial"   — auditoría (quién, cuándo, antes/después, motivo).
 *   · Commission: "participacionId", "ingresoId", "ventaTenantId", "reglaColaboradorId"
 *     + UNIQUE ("participacionId","ingresoId") = el candado de dedup de las participaciones.
 *
 * Aditiva e idempotente: todo es `IF NOT EXISTS` o va dentro de un DO que mira
 * `pg_constraint` antes de crear la FK. No toca ninguna fila existente: las
 * columnas nuevas de Commission son nullable y sin default.
 *
 * ORDEN: correr ESTO antes de desplegar el backend que lo usa. Al revés, Prisma
 * pide columnas de Commission que no existen y falla TODA lectura de comisiones
 * (el panel, los cortes y el webhook).
 *
 * Uso:
 *   railway run node scripts/apply-participaciones-migration.cjs            (solo mira)
 *   railway run node scripts/apply-participaciones-migration.cjs --aplicar  (escribe)
 */
const { PrismaClient } = require('@prisma/client');
// `railway run` inyecta la URL INTERNA, que solo resuelve dentro de Railway: se
// prefiere la PÚBLICA para que el script sirva desde un portátil.
const p = new PrismaClient({
  datasources: {
    db: { url: process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL },
  },
});

const APLICAR = process.argv.includes('--aplicar');

const PASOS = [
  `CREATE TABLE IF NOT EXISTS "ParticipacionGlobal" (
    "id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "beneficiarioCodeId" TEXT NOT NULL,
    "tipo" TEXT NOT NULL DEFAULT 'PORCENTAJE',
    "valor" DECIMAL(10,2) NOT NULL,
    "base" TEXT NOT NULL DEFAULT 'PRECIO_PLAN',
    "aplicaA" TEXT NOT NULL DEFAULT 'AMBAS',
    "periodicidades" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "planIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "negociosIncluidos" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "negociosExcluidos" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "vigenteDesde" TIMESTAMP(3),
    "vigenteHasta" TIMESTAMP(3),
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creadoPorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ParticipacionGlobal_pkey" PRIMARY KEY ("id")
  )`,
  `CREATE INDEX IF NOT EXISTS "ParticipacionGlobal_activo_idx" ON "ParticipacionGlobal"("activo")`,
  `CREATE INDEX IF NOT EXISTS "ParticipacionGlobal_beneficiarioCodeId_idx" ON "ParticipacionGlobal"("beneficiarioCodeId")`,
  `DO $$ BEGIN
     IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ParticipacionGlobal_beneficiarioCodeId_fkey') THEN
       ALTER TABLE "ParticipacionGlobal" ADD CONSTRAINT "ParticipacionGlobal_beneficiarioCodeId_fkey"
         FOREIGN KEY ("beneficiarioCodeId") REFERENCES "ReferralCode"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
     END IF;
   END $$`,

  `CREATE TABLE IF NOT EXISTS "ReglaComisionColaborador" (
    "id" TEXT NOT NULL,
    "codeId" TEXT NOT NULL,
    "nombre" TEXT,
    "prioridad" INTEGER NOT NULL DEFAULT 0,
    "tipo" TEXT NOT NULL DEFAULT 'PORCENTAJE',
    "valor" DECIMAL(10,2) NOT NULL,
    "aplicaA" TEXT NOT NULL DEFAULT 'AMBAS',
    "periodicidades" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "planIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "vigenteDesde" TIMESTAMP(3),
    "vigenteHasta" TIMESTAMP(3),
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creadoPorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ReglaComisionColaborador_pkey" PRIMARY KEY ("id")
  )`,
  `CREATE INDEX IF NOT EXISTS "ReglaComisionColaborador_codeId_activo_idx" ON "ReglaComisionColaborador"("codeId", "activo")`,
  `DO $$ BEGIN
     IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ReglaComisionColaborador_codeId_fkey') THEN
       ALTER TABLE "ReglaComisionColaborador" ADD CONSTRAINT "ReglaComisionColaborador_codeId_fkey"
         FOREIGN KEY ("codeId") REFERENCES "ReferralCode"("id") ON DELETE CASCADE ON UPDATE CASCADE;
     END IF;
   END $$`,

  `CREATE TABLE IF NOT EXISTS "ReglaDeComisionHistorial" (
    "id" TEXT NOT NULL,
    "ambito" TEXT NOT NULL,
    "reglaId" TEXT NOT NULL,
    "accion" TEXT NOT NULL,
    "antes" JSONB,
    "despues" JSONB,
    "motivo" TEXT NOT NULL,
    "actorId" TEXT,
    "actorEmail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ReglaDeComisionHistorial_pkey" PRIMARY KEY ("id")
  )`,
  `CREATE INDEX IF NOT EXISTS "ReglaDeComisionHistorial_ambito_reglaId_createdAt_idx" ON "ReglaDeComisionHistorial"("ambito", "reglaId", "createdAt")`,

  `ALTER TABLE "Commission" ADD COLUMN IF NOT EXISTS "participacionId" TEXT`,
  `ALTER TABLE "Commission" ADD COLUMN IF NOT EXISTS "ingresoId" TEXT`,
  `ALTER TABLE "Commission" ADD COLUMN IF NOT EXISTS "ventaTenantId" TEXT`,
  `ALTER TABLE "Commission" ADD COLUMN IF NOT EXISTS "reglaColaboradorId" TEXT`,
  // Postgres trata los NULL como distintos: las comisiones de siempre (las dos
  // columnas en null) nunca chocan con este índice.
  `CREATE UNIQUE INDEX IF NOT EXISTS "Commission_participacionId_ingresoId_key" ON "Commission"("participacionId", "ingresoId")`,
  `CREATE INDEX IF NOT EXISTS "Commission_ingresoId_idx" ON "Commission"("ingresoId")`,
  `CREATE INDEX IF NOT EXISTS "Commission_reglaColaboradorId_idx" ON "Commission"("reglaColaboradorId")`,
  `DO $$ BEGIN
     IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Commission_participacionId_fkey') THEN
       ALTER TABLE "Commission" ADD CONSTRAINT "Commission_participacionId_fkey"
         FOREIGN KEY ("participacionId") REFERENCES "ParticipacionGlobal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
     END IF;
   END $$`,
];

async function estado() {
  const tablas = await p.$queryRawUnsafe(`
    SELECT table_name FROM information_schema.tables
    WHERE table_name IN ('ParticipacionGlobal','ReglaComisionColaborador','ReglaDeComisionHistorial')
  `);
  const columnas = await p.$queryRawUnsafe(`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'Commission'
      AND column_name IN ('participacionId','ingresoId','ventaTenantId','reglaColaboradorId')
  `);
  return {
    tablas: tablas.map((t) => t.table_name).sort(),
    columnas: columnas.map((c) => c.column_name).sort(),
  };
}

(async () => {
  const antes = await estado();
  console.log('Antes:', JSON.stringify(antes));
  if (!APLICAR) {
    console.log(`\nSIMULACIÓN: se ejecutarían ${PASOS.length} sentencias (todas idempotentes).`);
    console.log('Vuelve a correrlo con --aplicar para escribir.');
    return p.$disconnect();
  }
  // Todo o nada: una FK que falle no deja la mitad de las columnas creadas.
  await p.$transaction(PASOS.map((sql) => p.$executeRawUnsafe(sql)));
  const despues = await estado();
  console.log('Después:', JSON.stringify(despues));
  const ok = despues.tablas.length === 3 && despues.columnas.length === 4;
  console.log(ok ? '\nMigración aplicada.' : '\nATENCIÓN: falta algo, revisa la salida.');
  // Comprobación: ninguna comisión existente quedó tocada.
  const tocadas = await p.$queryRawUnsafe(
    `SELECT count(*)::int AS n FROM "Commission" WHERE "participacionId" IS NOT NULL OR "reglaColaboradorId" IS NOT NULL`,
  );
  console.log(`Comisiones con las columnas nuevas llenas: ${tocadas[0].n} (recién migrado debe ser 0).`);
  await p.$disconnect();
})().catch(async (e) => {
  console.error('ERROR:', e.message);
  await p.$disconnect();
  process.exit(1);
});
