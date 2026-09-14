/**
 * «Clientes» de un equipo de ventas: la implementación de quien acaba de cerrar.
 *
 * Aditiva e idempotente. Crea dos tablas vacías y sus claves foráneas; no toca
 * ninguna fila existente. Nunca `prisma db push`: producción tiene índices
 * únicos parciales que un push borra.
 *
 * POR QUÉ EXISTE
 * --------------
 * La pestaña «Clientes» del equipo enseñaba los leads con `wonAt`: la MISMA
 * lista de leads con otro filtro. Después de vender, lo que hay que saber es
 * por dónde va la puesta en marcha y qué falta, y eso una lista de leads no lo
 * dice. En TeamClubify es una lista de comprobación de 6 pasos por cliente;
 * esto la trae a Clubify PRO para Sellea.
 *
 * LO QUE NO SE PUEDE ROMPER
 * -------------------------
 * · Sin columna `tenantId`, como el resto de tablas `Sales*`:
 *   `prisma-tenant-middleware.ts` filtra por negocio a todo modelo con un campo
 *   llamado así, y una implementación de un equipo de marca no tiene negocio.
 * · `leadId` es ÚNICO: es lo que hace idempotente el arranque automático al
 *   mover un lead a «Cliente». Dos movimientos, una sola implementación.
 * · Borrar el lead NO borra la implementación (SET NULL): es trabajo ya hecho.
 *
 * Uso:  railway run --service Postgres-Nq8w node scripts/apply-sales-implementations-migration.cjs [--aplicar]
 */
const { PrismaClient } = require('@prisma/client');

const APLICAR = process.argv.includes('--aplicar');
const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
const p = new PrismaClient({ datasources: { db: { url } } });

const hizo = [];
const salto = [];

/** Parte por `;`: `$executeRawUnsafe` no acepta varias sentencias de golpe. */
async function ejecutar(etiqueta, sql) {
  const sentencias = sql.split(';').map((s) => s.trim()).filter(Boolean);
  if (!APLICAR) {
    console.log(`\n-- ${etiqueta}`);
    for (const s of sentencias) console.log(`   ${s.replace(/\s+/g, ' ')};`);
    return;
  }
  for (const s of sentencias) await p.$executeRawUnsafe(s);
  hizo.push(etiqueta);
}

async function tablaExiste(tabla) {
  const r = await p.$queryRawUnsafe(
    `SELECT 1 FROM information_schema.tables WHERE table_name = $1`,
    tabla,
  );
  return r.length > 0;
}

async function restriccionExiste(nombre) {
  const r = await p.$queryRawUnsafe(
    `SELECT 1 FROM pg_constraint WHERE conname = $1`,
    nombre,
  );
  return r.length > 0;
}

const TABLAS = {
  SalesImplementation: `
    CREATE TABLE IF NOT EXISTS "SalesImplementation" (
      "id" TEXT NOT NULL, "salesTeamId" TEXT NOT NULL, "whiteLabelId" TEXT,
      "leadId" TEXT, "name" TEXT NOT NULL, "clientName" TEXT, "plan" TEXT,
      "status" TEXT NOT NULL DEFAULT 'pendiente',
      "startDate" TIMESTAMP(3), "dueDate" TIMESTAMP(3),
      "createdByUserId" TEXT,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "SalesImplementation_pkey" PRIMARY KEY ("id")
    );
    CREATE UNIQUE INDEX IF NOT EXISTS "SalesImplementation_leadId_key" ON "SalesImplementation"("leadId");
    CREATE INDEX IF NOT EXISTS "SalesImplementation_salesTeamId_status_idx" ON "SalesImplementation"("salesTeamId","status");
    CREATE INDEX IF NOT EXISTS "SalesImplementation_whiteLabelId_idx" ON "SalesImplementation"("whiteLabelId")`,

  SalesImplementationItem: `
    CREATE TABLE IF NOT EXISTS "SalesImplementationItem" (
      "id" TEXT NOT NULL, "implementationId" TEXT NOT NULL,
      "title" TEXT NOT NULL, "position" INTEGER NOT NULL DEFAULT 0,
      "done" BOOLEAN NOT NULL DEFAULT false,
      "doneAt" TIMESTAMP(3), "doneByUserId" TEXT,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "SalesImplementationItem_pkey" PRIMARY KEY ("id")
    );
    CREATE INDEX IF NOT EXISTS "SalesImplementationItem_implementationId_position_idx" ON "SalesImplementationItem"("implementationId","position")`,
};

// Postgres no tiene `ADD CONSTRAINT IF NOT EXISTS`: se comprueba antes.
const CLAVES = [
  ['SalesImplementation_salesTeamId_fkey', `ALTER TABLE "SalesImplementation" ADD CONSTRAINT "SalesImplementation_salesTeamId_fkey" FOREIGN KEY ("salesTeamId") REFERENCES "SalesTeam"("id") ON DELETE CASCADE ON UPDATE CASCADE`],
  ['SalesImplementation_leadId_fkey', `ALTER TABLE "SalesImplementation" ADD CONSTRAINT "SalesImplementation_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "SalesLead"("id") ON DELETE SET NULL ON UPDATE CASCADE`],
  ['SalesImplementationItem_implementationId_fkey', `ALTER TABLE "SalesImplementationItem" ADD CONSTRAINT "SalesImplementationItem_implementationId_fkey" FOREIGN KEY ("implementationId") REFERENCES "SalesImplementation"("id") ON DELETE CASCADE ON UPDATE CASCADE`],
];

(async () => {
  if (!url) { console.error('No DATABASE_URL'); process.exit(1); }
  console.log(APLICAR ? '*** APLICANDO ***' : 'ENSAYO (no escribe nada)');

  for (const [tabla, sql] of Object.entries(TABLAS)) {
    if (await tablaExiste(tabla)) { salto.push(tabla); continue; }
    await ejecutar(`tabla ${tabla}`, sql);
  }
  for (const [nombre, sql] of CLAVES) {
    if (await restriccionExiste(nombre)) { salto.push(nombre); continue; }
    await ejecutar(`FK ${nombre}`, sql);
  }

  if (!APLICAR) {
    console.log(`\n-- ENSAYO. Ya existían: ${salto.length ? salto.join(', ') : 'nada'}. Con --aplicar se ejecuta lo de arriba.`);
    await p.$disconnect();
    return;
  }
  console.log(`\nAplicado (${hizo.length}):`);
  for (const x of hizo) console.log(`  ✓ ${x}`);
  if (salto.length) console.log(`Ya estaba (${salto.length}): ${salto.join(', ')}`);
  for (const t of Object.keys(TABLAS)) {
    const [{ n }] = await p.$queryRawUnsafe(`SELECT COUNT(*)::int AS n FROM "${t}"`);
    console.log(`  ${t}: ${n} filas`);
  }
  await p.$disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
