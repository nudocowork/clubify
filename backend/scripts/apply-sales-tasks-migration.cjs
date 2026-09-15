/**
 * «Tareas del CRM» de un equipo de ventas: las tareas y el catálogo de acciones.
 *
 * Aditiva e idempotente: dos tablas vacías, sus índices y sus claves foráneas.
 * No toca ninguna fila existente. Nunca `prisma db push`.
 *
 * POR QUÉ EXISTE
 * --------------
 * TeamClubify tiene, en cada equipo, «Tareas del CRM»: lo que hay que hacer con
 * un contacto, con fecha y responsable, y vistas de Pendientes / Vencidas / Hoy /
 * Mías / Completadas. La acción se elige de un catálogo de títulos cortos
 * («Seguimiento», «Llamar») y el detalle va en la descripción. Clubify PRO no
 * tenía nada parecido: el seguimiento vivía solo en las notas del lead.
 *
 * LO QUE NO SE PUEDE ROMPER
 * -------------------------
 * · Sin columna `tenantId`, como el resto de `Sales*`.
 * · Borrar un lead borra sus tareas; borrar el equipo borra su catálogo.
 * · Un nombre de acción es único POR EQUIPO: dos primeras visitas a la vez no
 *   siembran «Seguimiento» dos veces.
 *
 * Uso:  railway run --service Postgres-Nq8w node scripts/apply-sales-tasks-migration.cjs [--aplicar]
 */
const { PrismaClient } = require('@prisma/client');

const APLICAR = process.argv.includes('--aplicar');
const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
const p = new PrismaClient({ datasources: { db: { url } } });

const TABLAS = {
  SalesTask: [
    `CREATE TABLE IF NOT EXISTS "SalesTask" (
       "id" TEXT NOT NULL, "salesTeamId" TEXT NOT NULL, "leadId" TEXT NOT NULL,
       "title" TEXT NOT NULL, "body" TEXT, "dueDate" TEXT, "assignedUserId" TEXT,
       "done" BOOLEAN NOT NULL DEFAULT false, "doneAt" TIMESTAMP(3),
       "createdByUserId" TEXT,
       "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
       "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
       CONSTRAINT "SalesTask_pkey" PRIMARY KEY ("id")
     )`,
    `CREATE INDEX IF NOT EXISTS "SalesTask_salesTeamId_done_dueDate_idx" ON "SalesTask"("salesTeamId","done","dueDate")`,
    `CREATE INDEX IF NOT EXISTS "SalesTask_leadId_done_idx" ON "SalesTask"("leadId","done")`,
    `CREATE INDEX IF NOT EXISTS "SalesTask_salesTeamId_assignedUserId_done_idx" ON "SalesTask"("salesTeamId","assignedUserId","done")`,
  ],
  SalesTaskAction: [
    `CREATE TABLE IF NOT EXISTS "SalesTaskAction" (
       "id" TEXT NOT NULL, "salesTeamId" TEXT NOT NULL, "name" TEXT NOT NULL,
       "position" INTEGER NOT NULL DEFAULT 0,
       "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
       CONSTRAINT "SalesTaskAction_pkey" PRIMARY KEY ("id")
     )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS "SalesTaskAction_salesTeamId_name_key" ON "SalesTaskAction"("salesTeamId","name")`,
    `CREATE INDEX IF NOT EXISTS "SalesTaskAction_salesTeamId_position_idx" ON "SalesTaskAction"("salesTeamId","position")`,
  ],
};

const FKS = [
  ['SalesTask_leadId_fkey', `ALTER TABLE "SalesTask" ADD CONSTRAINT "SalesTask_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "SalesLead"("id") ON DELETE CASCADE ON UPDATE CASCADE`],
  ['SalesTaskAction_salesTeamId_fkey', `ALTER TABLE "SalesTaskAction" ADD CONSTRAINT "SalesTaskAction_salesTeamId_fkey" FOREIGN KEY ("salesTeamId") REFERENCES "SalesTeam"("id") ON DELETE CASCADE ON UPDATE CASCADE`],
];

(async () => {
  if (!url) { console.error('No DATABASE_URL'); process.exit(1); }
  console.log(APLICAR ? '*** APLICANDO ***' : 'ENSAYO (no escribe nada)');

  const sentencias = [];
  for (const [tabla, sql] of Object.entries(TABLAS)) {
    const [{ existe }] = await p.$queryRawUnsafe(
      `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = $1) AS existe`,
      tabla,
    );
    console.log(`tabla ${tabla} ya existía: ${existe}`);
    // La tabla, solo si falta; cada índice, si falta ÉL. Antes los índices solo
    // se encolaban con la tabla: si una pasada anterior la creó y cayó antes del
    // índice único, la siguiente decía «nada que hacer» y producción se quedaba
    // sin lo que impide sembrar «Seguimiento» dos veces (Fable, 2026-09-14).
    const [crear, ...indices] = sql;
    if (!existe) sentencias.push(crear);
    for (const idx of indices) {
      const nombre = /INDEX IF NOT EXISTS "([^"]+)"/.exec(idx)[1];
      const [{ hay }] = await p.$queryRawUnsafe(
        `SELECT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = $1) AS hay`,
        nombre,
      );
      if (!hay) sentencias.push(idx);
    }
  }
  for (const [nombre, sql] of FKS) {
    const [{ fk }] = await p.$queryRawUnsafe(
      `SELECT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = $1) AS fk`,
      nombre,
    );
    console.log(`clave ${nombre} ya existía: ${fk}`);
    if (!fk) sentencias.push(sql);
  }

  if (!APLICAR) {
    for (const s of sentencias) console.log(`   ${s.replace(/\s+/g, ' ')};`);
    console.log(sentencias.length ? '\n-- ENSAYO. Con --aplicar se ejecuta lo de arriba.' : '\n-- Nada que hacer.');
    await p.$disconnect();
    return;
  }
  for (const s of sentencias) {
    await p.$executeRawUnsafe(s);
    console.log(`  ✓ ${s.replace(/\s+/g, ' ').slice(0, 90)}…`);
  }
  for (const tabla of Object.keys(TABLAS)) {
    const [{ n }] = await p.$queryRawUnsafe(`SELECT COUNT(*)::int AS n FROM "${tabla}"`);
    console.log(`listo · ${tabla}: ${n} filas`);
  }
  await p.$disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
