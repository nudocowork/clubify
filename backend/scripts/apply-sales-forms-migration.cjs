/**
 * «Formularios» de un equipo de ventas: los formularios y sus respuestas.
 *
 * Aditiva e idempotente: dos tablas vacías, sus índices y sus claves foráneas.
 * No toca ninguna fila existente. Nunca `prisma db push`.
 *
 * POR QUÉ EXISTE
 * --------------
 * TeamClubify tiene, en cada equipo, un constructor de formularios: preguntas
 * de muchos tipos, secciones, opciones con puntaje, preguntas que solo salen
 * según otra respuesta, y a qué dato del lead va cada una. El formulario que el
 * equipo elige es lo que rellena quien reserva en su agenda pública. La agenda
 * de Clubify PRO solo pedía nombre y teléfono.
 *
 * LO QUE NO SE PUEDE ROMPER
 * -------------------------
 * · Sin columna `tenantId`, como el resto de `Sales*`.
 * · Una respuesta guarda TODO lo contestado, también lo que no tiene columna en
 *   el lead (facturación, «¿invertir?»): no se pierde nada.
 * · Borrar un formulario con respuestas se NIEGA (NO ACTION): se desactiva. Pero
 *   borrar el equipo se lleva formularios y respuestas en cascada — el NO ACTION
 *   se comprueba al final de la sentencia y no choca con esa cascada.
 * · Borrar un lead no borra sus respuestas: se quedan sin lead (SET NULL).
 *
 * Uso:  railway run --service Postgres-Nq8w node scripts/apply-sales-forms-migration.cjs [--aplicar]
 */
const { PrismaClient } = require('@prisma/client');

const APLICAR = process.argv.includes('--aplicar');
const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
const p = new PrismaClient({ datasources: { db: { url } } });

const TABLAS = {
  SalesForm: [
    `CREATE TABLE IF NOT EXISTS "SalesForm" (
       "id" TEXT NOT NULL, "salesTeamId" TEXT NOT NULL, "whiteLabelId" TEXT,
       "name" TEXT NOT NULL, "description" TEXT,
       "fields" JSONB NOT NULL DEFAULT '[]',
       "redirectWhatsapp" TEXT, "redirectMessage" TEXT,
       "isActive" BOOLEAN NOT NULL DEFAULT true, "createdByUserId" TEXT,
       "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
       "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
       CONSTRAINT "SalesForm_pkey" PRIMARY KEY ("id")
     )`,
    `CREATE INDEX IF NOT EXISTS "SalesForm_salesTeamId_createdAt_idx" ON "SalesForm"("salesTeamId","createdAt")`,
  ],
  SalesFormResponse: [
    `CREATE TABLE IF NOT EXISTS "SalesFormResponse" (
       "id" TEXT NOT NULL, "salesTeamId" TEXT NOT NULL, "formId" TEXT NOT NULL,
       "leadId" TEXT, "meetingId" TEXT,
       "answers" JSONB NOT NULL DEFAULT '{}',
       "score" INTEGER NOT NULL DEFAULT 0,
       "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
       CONSTRAINT "SalesFormResponse_pkey" PRIMARY KEY ("id")
     )`,
    `CREATE INDEX IF NOT EXISTS "SalesFormResponse_formId_createdAt_idx" ON "SalesFormResponse"("formId","createdAt")`,
    `CREATE INDEX IF NOT EXISTS "SalesFormResponse_leadId_idx" ON "SalesFormResponse"("leadId")`,
  ],
};

const FKS = [
  ['SalesForm_salesTeamId_fkey', `ALTER TABLE "SalesForm" ADD CONSTRAINT "SalesForm_salesTeamId_fkey" FOREIGN KEY ("salesTeamId") REFERENCES "SalesTeam"("id") ON DELETE CASCADE ON UPDATE CASCADE`],
  ['SalesFormResponse_salesTeamId_fkey', `ALTER TABLE "SalesFormResponse" ADD CONSTRAINT "SalesFormResponse_salesTeamId_fkey" FOREIGN KEY ("salesTeamId") REFERENCES "SalesTeam"("id") ON DELETE CASCADE ON UPDATE CASCADE`],
  ['SalesFormResponse_formId_fkey', `ALTER TABLE "SalesFormResponse" ADD CONSTRAINT "SalesFormResponse_formId_fkey" FOREIGN KEY ("formId") REFERENCES "SalesForm"("id") ON DELETE NO ACTION ON UPDATE CASCADE`],
  ['SalesFormResponse_leadId_fkey', `ALTER TABLE "SalesFormResponse" ADD CONSTRAINT "SalesFormResponse_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "SalesLead"("id") ON DELETE SET NULL ON UPDATE CASCADE`],
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
    // La tabla, solo si falta; cada índice, si falta ÉL: una pasada cortada
    // después de crear la tabla no puede dejar producción sin sus índices.
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
