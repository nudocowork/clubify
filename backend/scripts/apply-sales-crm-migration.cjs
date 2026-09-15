/**
 * «CRM» de un equipo de ventas: EMBUDOS de oportunidades (como TeamClubify).
 *
 * Aditiva e idempotente: crea tres tablas vacías, sus índices y sus claves
 * foráneas. No toca ninguna fila existente. Nunca `prisma db push`.
 *
 * POR QUÉ EXISTE
 * --------------
 * El «CRM» del equipo era el tablero de LEADS: un solo juego de columnas y el
 * valor en la tarjeta. En TeamClubify el CRM son embudos de OPORTUNIDADES: cada
 * equipo tiene varios, cada oportunidad lleva contacto, valor, responsable y
 * estado (abierta · ganada · perdida · abandonada), y un contacto puede tener
 * varias. Javier eligió traerlo así (2026-09-14) en vez de partir el tablero de
 * leads en embudos, porque Banco, Seguimientos, Clientes y la reserva pública
 * dependen de las columnas de ese tablero.
 *
 * LO QUE NO SE PUEDE ROMPER
 * -------------------------
 * · Sin columna `tenantId`, como el resto de `Sales*`: el middleware filtra por
 *   negocio a todo modelo con ese campo.
 * · Borrar el equipo borra sus embudos; borrar un embudo borra sus etapas y sus
 *   oportunidades (CASCADE). Borrar un LEAD borra sus oportunidades.
 * · Borrar una etapa con oportunidades dentro se NIEGA (NO ACTION, que se
 *   comprueba al final de la sentencia y así no choca con la cascada del embudo).
 *
 * Uso:  railway run --service Postgres-Nq8w node scripts/apply-sales-crm-migration.cjs [--aplicar]
 */
const { PrismaClient } = require('@prisma/client');

const APLICAR = process.argv.includes('--aplicar');
const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
const p = new PrismaClient({ datasources: { db: { url } } });

const TABLAS = {
  SalesPipeline: [
    `CREATE TABLE IF NOT EXISTS "SalesPipeline" (
       "id" TEXT NOT NULL, "salesTeamId" TEXT NOT NULL, "whiteLabelId" TEXT,
       "name" TEXT NOT NULL, "position" INTEGER NOT NULL DEFAULT 0,
       "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
       "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
       CONSTRAINT "SalesPipeline_pkey" PRIMARY KEY ("id")
     )`,
    `CREATE INDEX IF NOT EXISTS "SalesPipeline_salesTeamId_position_idx" ON "SalesPipeline"("salesTeamId","position")`,
  ],
  SalesPipelineStage: [
    `CREATE TABLE IF NOT EXISTS "SalesPipelineStage" (
       "id" TEXT NOT NULL, "pipelineId" TEXT NOT NULL, "salesTeamId" TEXT NOT NULL,
       "name" TEXT NOT NULL, "position" INTEGER NOT NULL DEFAULT 0, "color" TEXT,
       "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
       CONSTRAINT "SalesPipelineStage_pkey" PRIMARY KEY ("id")
     )`,
    `CREATE INDEX IF NOT EXISTS "SalesPipelineStage_pipelineId_position_idx" ON "SalesPipelineStage"("pipelineId","position")`,
  ],
  SalesOpportunity: [
    `CREATE TABLE IF NOT EXISTS "SalesOpportunity" (
       "id" TEXT NOT NULL, "salesTeamId" TEXT NOT NULL, "whiteLabelId" TEXT,
       "pipelineId" TEXT NOT NULL, "stageId" TEXT NOT NULL, "leadId" TEXT NOT NULL,
       "name" TEXT NOT NULL, "value" DECIMAL(12,2) NOT NULL DEFAULT 0,
       "status" TEXT NOT NULL DEFAULT 'abierta', "source" TEXT,
       "assignedUserId" TEXT, "lostReason" TEXT,
       "position" INTEGER NOT NULL DEFAULT 0, "createdByUserId" TEXT,
       "wonAt" TIMESTAMP(3), "lostAt" TIMESTAMP(3),
       "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
       "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
       CONSTRAINT "SalesOpportunity_pkey" PRIMARY KEY ("id")
     )`,
    `CREATE INDEX IF NOT EXISTS "SalesOpportunity_pipelineId_stageId_position_idx" ON "SalesOpportunity"("pipelineId","stageId","position")`,
    `CREATE INDEX IF NOT EXISTS "SalesOpportunity_salesTeamId_status_idx" ON "SalesOpportunity"("salesTeamId","status")`,
    `CREATE INDEX IF NOT EXISTS "SalesOpportunity_leadId_idx" ON "SalesOpportunity"("leadId")`,
  ],
};

const FKS = [
  ['SalesPipeline_salesTeamId_fkey', `ALTER TABLE "SalesPipeline" ADD CONSTRAINT "SalesPipeline_salesTeamId_fkey" FOREIGN KEY ("salesTeamId") REFERENCES "SalesTeam"("id") ON DELETE CASCADE ON UPDATE CASCADE`],
  ['SalesPipelineStage_pipelineId_fkey', `ALTER TABLE "SalesPipelineStage" ADD CONSTRAINT "SalesPipelineStage_pipelineId_fkey" FOREIGN KEY ("pipelineId") REFERENCES "SalesPipeline"("id") ON DELETE CASCADE ON UPDATE CASCADE`],
  ['SalesOpportunity_pipelineId_fkey', `ALTER TABLE "SalesOpportunity" ADD CONSTRAINT "SalesOpportunity_pipelineId_fkey" FOREIGN KEY ("pipelineId") REFERENCES "SalesPipeline"("id") ON DELETE CASCADE ON UPDATE CASCADE`],
  ['SalesOpportunity_stageId_fkey', `ALTER TABLE "SalesOpportunity" ADD CONSTRAINT "SalesOpportunity_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "SalesPipelineStage"("id") ON DELETE NO ACTION ON UPDATE CASCADE`],
  ['SalesOpportunity_leadId_fkey', `ALTER TABLE "SalesOpportunity" ADD CONSTRAINT "SalesOpportunity_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "SalesLead"("id") ON DELETE CASCADE ON UPDATE CASCADE`],
];

(async () => {
  if (!url) { console.error('No DATABASE_URL'); process.exit(1); }
  console.log(APLICAR ? '*** APLICANDO ***' : 'ENSAYO (no escribe nada)');

  const sentencias = [];
  // En orden: las tablas antes que las claves que las enlazan.
  for (const [tabla, sql] of Object.entries(TABLAS)) {
    const [{ existe }] = await p.$queryRawUnsafe(
      `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = $1) AS existe`,
      tabla,
    );
    console.log(`tabla ${tabla} ya existía: ${existe}`);
    if (!existe) sentencias.push(...sql);
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
