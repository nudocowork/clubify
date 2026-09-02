/**
 * Crea las tablas de la Tarjeta de Club.
 *
 * SQL crudo y aditivo, no `prisma db push`: producción tiene índices únicos
 * parciales que Prisma no sabe expresar y un push los borra. Modelo copiado de
 * `apply-email-config-migration.cjs`.
 *
 * Idempotente: correrlo dos veces no hace nada la segunda. `CREATE TYPE` no
 * admite `IF NOT EXISTS`, así que va envuelto en un bloque que se traga el
 * duplicado.
 *
 *   railway run node scripts/apply-club-migration.cjs
 */
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

const PASOS = [
  [
    'enum ClubMembresiaStatus',
    `DO $$ BEGIN
       CREATE TYPE "ClubMembresiaStatus" AS ENUM ('ACTIVA','PAUSADA','CANCELADA');
     EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
  ],
  [
    'tabla ClubPlan',
    `CREATE TABLE IF NOT EXISTS "ClubPlan" (
       "id"               TEXT PRIMARY KEY,
       "tenantId"         TEXT NOT NULL REFERENCES "Tenant"("id") ON DELETE CASCADE,
       "name"             TEXT NOT NULL,
       "slug"             TEXT NOT NULL,
       "description"      TEXT NOT NULL DEFAULT '',
       "beneficiosPorMes" INTEGER NOT NULL DEFAULT 10,
       "unidad"           TEXT NOT NULL DEFAULT 'beneficio',
       "precioCents"      INTEGER NOT NULL DEFAULT 0,
       "currency"         TEXT NOT NULL DEFAULT 'COP',
       "isActive"         BOOLEAN NOT NULL DEFAULT true,
       "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
       "updatedAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
     )`,
  ],
  ['índice ClubPlan (slug)', `CREATE UNIQUE INDEX IF NOT EXISTS "ClubPlan_tenantId_slug_key" ON "ClubPlan"("tenantId","slug")`],
  ['índice ClubPlan (activos)', `CREATE INDEX IF NOT EXISTS "ClubPlan_tenantId_isActive_idx" ON "ClubPlan"("tenantId","isActive")`],
  [
    'tabla ClubTramoAlta',
    `CREATE TABLE IF NOT EXISTS "ClubTramoAlta" (
       "id"         TEXT PRIMARY KEY,
       "planId"     TEXT NOT NULL REFERENCES "ClubPlan"("id") ON DELETE CASCADE,
       "desdeDia"   INTEGER NOT NULL,
       "hastaDia"   INTEGER NOT NULL,
       "beneficios" INTEGER NOT NULL
     )`,
  ],
  ['índice ClubTramoAlta', `CREATE INDEX IF NOT EXISTS "ClubTramoAlta_planId_desdeDia_idx" ON "ClubTramoAlta"("planId","desdeDia")`],
  [
    'tabla ClubMembresia',
    `CREATE TABLE IF NOT EXISTS "ClubMembresia" (
       "id"             TEXT PRIMARY KEY,
       "planId"         TEXT NOT NULL REFERENCES "ClubPlan"("id") ON DELETE CASCADE,
       "customerId"     TEXT NOT NULL REFERENCES "Customer"("id") ON DELETE CASCADE,
       "passId"         TEXT REFERENCES "Pass"("id") ON DELETE SET NULL,
       "status"         "ClubMembresiaStatus" NOT NULL DEFAULT 'ACTIVA',
       "periodo"        TEXT NOT NULL,
       "cupoDelPeriodo" INTEGER NOT NULL DEFAULT 0,
       "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
       "pausedAt"       TIMESTAMP(3),
       "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
     )`,
  ],
  // Un cliente, una membresía por plan. Es la red que impide que un doble clic
  // en el alta cree dos y le duplique el cupo.
  // El interruptor del módulo. Arranca apagado para TODOS: encenderlo cambia
  // el menú del panel, y eso se decide negocio por negocio.
  [
    'columna Tenant.clubEnabled',
    `ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "clubEnabled" BOOLEAN NOT NULL DEFAULT false`,
  ],
  ['índice ClubMembresia (única por plan)', `CREATE UNIQUE INDEX IF NOT EXISTS "ClubMembresia_planId_customerId_key" ON "ClubMembresia"("planId","customerId")`],
  ['índice ClubMembresia (pase)', `CREATE UNIQUE INDEX IF NOT EXISTS "ClubMembresia_passId_key" ON "ClubMembresia"("passId")`],
  // Índices añadidos el 2026-09-02 tras medir las consultas reales.
  [
    'índice ClubMembresia (listado por fecha)',
    `CREATE INDEX IF NOT EXISTS "ClubMembresia_planId_status_createdAt_idx" ON "ClubMembresia"("planId","status","createdAt" DESC)`,
  ],
  [
    'índice ClubMembresia (cron por período)',
    `CREATE INDEX IF NOT EXISTS "ClubMembresia_periodo_status_idx" ON "ClubMembresia"("periodo","status")`,
  ],
  [
    'única Card (una plantilla por plan)',
    `CREATE UNIQUE INDEX IF NOT EXISTS "Card_tenantId_clubPlanId_key" ON "Card"("tenantId","clubPlanId")`,
  ],
  ['índice ClubMembresia (estado)', `CREATE INDEX IF NOT EXISTS "ClubMembresia_planId_status_idx" ON "ClubMembresia"("planId","status")`],
  ['índice ClubMembresia (período)', `CREATE INDEX IF NOT EXISTS "ClubMembresia_status_periodo_idx" ON "ClubMembresia"("status","periodo")`],
  [
    'tabla ClubConsumo',
    `CREATE TABLE IF NOT EXISTS "ClubConsumo" (
       "id"              TEXT PRIMARY KEY,
       "membresiaId"     TEXT NOT NULL REFERENCES "ClubMembresia"("id") ON DELETE CASCADE,
       "cantidad"        INTEGER NOT NULL DEFAULT 1,
       "saldoResultante" INTEGER NOT NULL,
       "periodo"         TEXT NOT NULL,
       "actorId"         TEXT,
       "locationId"      TEXT REFERENCES "Location"("id") ON DELETE SET NULL,
       "revertedAt"      TIMESTAMP(3),
       "revertedBy"      TEXT,
       "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
     )`,
  ],
  ['índice ClubConsumo (fecha)', `CREATE INDEX IF NOT EXISTS "ClubConsumo_membresiaId_createdAt_idx" ON "ClubConsumo"("membresiaId","createdAt")`],
  ['índice ClubConsumo (período)', `CREATE INDEX IF NOT EXISTS "ClubConsumo_membresiaId_periodo_idx" ON "ClubConsumo"("membresiaId","periodo")`],
  [
    'Card.clubPlanId',
    `ALTER TABLE "Card" ADD COLUMN IF NOT EXISTS "clubPlanId" TEXT`,
  ],
  [
    'FK de Card.clubPlanId',
    `DO $$ BEGIN
       ALTER TABLE "Card" ADD CONSTRAINT "Card_clubPlanId_fkey"
         FOREIGN KEY ("clubPlanId") REFERENCES "ClubPlan"("id") ON DELETE CASCADE;
     EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
  ],
];

(async () => {
  for (const [nombre, sql] of PASOS) {
    // Una sentencia por entrada, sin trocear: los bloques `DO $$ ... $$`
    // llevan `;` dentro y partirlos por ahí los deja sin cerrar.
    await p.$executeRawUnsafe(sql);
    console.log(`  ok · ${nombre}`);
  }

  const tablas = await p.$queryRawUnsafe(
    `SELECT table_name FROM information_schema.tables
      WHERE table_name IN ('ClubPlan','ClubTramoAlta','ClubMembresia','ClubConsumo')`,
  );
  if (tablas.length !== 4) {
    throw new Error(`esperaba 4 tablas, hay ${tablas.length}`);
  }
  const col = await p.$queryRawUnsafe(
    `SELECT COUNT(*)::int AS n FROM information_schema.columns
      WHERE table_name='Card' AND column_name='clubPlanId'`,
  );
  if (col[0].n !== 1) throw new Error('falta Card.clubPlanId');
  const flag = await p.$queryRawUnsafe(
    `SELECT COUNT(*)::int AS n FROM information_schema.columns
      WHERE table_name='Tenant' AND column_name='clubEnabled'`,
  );
  if (flag[0].n !== 1) throw new Error('falta Tenant.clubEnabled');

  console.log(
    `\nlisto · 4 tablas + Card.clubPlanId + Tenant.clubEnabled · planes existentes: ${await p.clubPlan.count()}`,
  );
  await p.$disconnect();
})().catch((e) => {
  console.error('ERR', e.message);
  process.exit(1);
});
