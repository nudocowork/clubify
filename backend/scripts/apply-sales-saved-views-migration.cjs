/**
 * «Contactos» de un equipo de ventas: las LISTAS GUARDADAS (vistas con filtros).
 *
 * Aditiva e idempotente: crea una tabla vacía y su clave foránea. No toca
 * ninguna fila. Nunca `prisma db push`.
 *
 * POR QUÉ EXISTE
 * --------------
 * En TeamClubify, Contactos permite guardar un filtro con nombre —«sin
 * etiqueta», «vinieron de Instagram», «en seguimiento»— y volver a él de un
 * clic. Es lo que convierte una tabla de miles de personas en listas de trabajo.
 * Esta tabla es `ContactSavedView` de TeamClubify, traída a Clubify PRO.
 *
 * LO QUE NO SE PUEDE ROMPER
 * -------------------------
 * · Sin columna `tenantId`, como el resto de `Sales*`: el middleware filtra por
 *   negocio a todo modelo con ese campo, y una vista de un equipo de marca no
 *   tiene negocio.
 * · La vista es DEL EQUIPO (`salesTeamId` NOT NULL), no global: una lista de
 *   Sellea no puede aparecerle a otro equipo, y menos a otra marca. En
 *   TeamClubify la columna es opcional por las vistas históricas; aquí no hay
 *   historia que arrastrar.
 * · Borrar el equipo borra sus vistas (CASCADE): sin equipo no filtran nada.
 *
 * Uso:  railway run --service Postgres-Nq8w node scripts/apply-sales-saved-views-migration.cjs [--aplicar]
 */
const { PrismaClient } = require('@prisma/client');

const APLICAR = process.argv.includes('--aplicar');
const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
const p = new PrismaClient({ datasources: { db: { url } } });

const TABLA = [
  `CREATE TABLE IF NOT EXISTS "SalesSavedView" (
     "id" TEXT NOT NULL, "salesTeamId" TEXT NOT NULL, "whiteLabelId" TEXT,
     "name" TEXT NOT NULL, "filters" JSONB NOT NULL DEFAULT '{}',
     "createdByUserId" TEXT,
     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
     CONSTRAINT "SalesSavedView_pkey" PRIMARY KEY ("id")
   )`,
  `CREATE INDEX IF NOT EXISTS "SalesSavedView_salesTeamId_createdAt_idx" ON "SalesSavedView"("salesTeamId","createdAt")`,
];
const FK_NOMBRE = 'SalesSavedView_salesTeamId_fkey';
const FK = `ALTER TABLE "SalesSavedView" ADD CONSTRAINT "${FK_NOMBRE}" FOREIGN KEY ("salesTeamId") REFERENCES "SalesTeam"("id") ON DELETE CASCADE ON UPDATE CASCADE`;

(async () => {
  if (!url) { console.error('No DATABASE_URL'); process.exit(1); }
  console.log(APLICAR ? '*** APLICANDO ***' : 'ENSAYO (no escribe nada)');

  const [{ existe }] = await p.$queryRawUnsafe(
    `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'SalesSavedView') AS existe`,
  );
  const [{ fk }] = await p.$queryRawUnsafe(
    `SELECT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = $1) AS fk`,
    FK_NOMBRE,
  );
  const sentencias = [...(existe ? [] : TABLA), ...(fk ? [] : [FK])];
  console.log(`tabla ya existía: ${existe} · clave foránea ya existía: ${fk}`);

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
  const [{ n }] = await p.$queryRawUnsafe(`SELECT COUNT(*)::int AS n FROM "SalesSavedView"`);
  console.log(`\nlisto · SalesSavedView: ${n} filas`);
  await p.$disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
