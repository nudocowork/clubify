/**
 * FASE 1 de «Equipos de Ventas por marca»: las tablas, y nadie las lee.
 *
 * Aditiva e idempotente. A propósito NO cambia el comportamiento de nada: al
 * terminar, las 7 tablas nuevas están vacías, `SALES_TEAMS` no está encendido
 * en ninguna marca, y la pantalla de equipos que hoy usa Clubify sigue igual.
 * Es el mismo arranque que se usó con `ProductLocation`.
 *
 * QUÉ SE AÑADE, Y POR QUÉ ASÍ
 * ---------------------------
 * · `ModuleKey += SALES_TEAMS` — el interruptor por marca. Va aquí y no en el
 *   negocio porque el equipo es DE LA MARCA: un flag en el negocio no tendría
 *   dueño.
 *
 * · `SalesTeam` gana `whiteLabelId`. Hoy la marca de un equipo se ADIVINA por
 *   el código de referido de su líder, así que un equipo sin líder no es de
 *   nadie. Se rellena abajo solo cuando la deducción es inequívoca.
 *
 * · NINGUNA tabla nueva tiene una columna llamada `tenantId`, y no es
 *   descuido: `prisma-tenant-middleware.ts` recoge del DMMF **todo modelo con
 *   un campo llamado así** y le inyecta el filtro por negocio. Una tabla de
 *   equipo de marca no tiene negocio; con esa columna, el middleware la
 *   escondería o la bloquearía según quién preguntara. Si algún día un negocio
 *   quiere su propio equipo, la columna se llamará `ownerTenantId`.
 *
 * · El lead es tabla propia (`SalesLead`) enlazada a `MktContact` por id, sin
 *   clave foránea. No se reutiliza `CrmContact` porque su `ownerUserId` es NOT
 *   NULL con borrado en cascada y los usuarios se borran en duro: al salir un
 *   vendedor se llevaría los leads del equipo. Y no se le añade `salesTeamId`
 *   a `MktContact` porque tiene índices únicos parciales por marca — una fila
 *   por persona — y la misma persona en dos equipos los rompería.
 *
 * Uso:  railway run node scripts/apply-sales-teams-migration.cjs
 */
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

const hizo = [];
const salto = [];

/**
 * Ejecuta el bloque sentencia a sentencia.
 *
 * `$executeRawUnsafe` usa una sentencia preparada y Postgres rechaza varias de
 * golpe («cannot insert multiple commands into a prepared statement»), así que
 * el bloque se parte por `;`. Se escriben así, juntas, porque una tabla y sus
 * índices se leen mejor de un tirón que repartidos en ocho constantes.
 */
async function ejecutar(etiqueta, sql) {
  const sentencias = sql
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);
  for (const s of sentencias) {
    await p.$executeRawUnsafe(s);
  }
  hizo.push(etiqueta);
}

async function columnaExiste(tabla, columna) {
  const r = await p.$queryRawUnsafe(
    `SELECT 1 FROM information_schema.columns WHERE table_name = $1 AND column_name = $2`,
    tabla,
    columna,
  );
  return r.length > 0;
}

async function tablaExiste(tabla) {
  const r = await p.$queryRawUnsafe(
    `SELECT to_regclass($1) IS NOT NULL AS existe`,
    `public."${tabla}"`,
  );
  return !!r[0]?.existe;
}

(async () => {
  // ── 1. El interruptor por marca ───────────────────────────────────────
  const valores = await p.$queryRawUnsafe(`
    SELECT e.enumlabel AS v FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typname = 'ModuleKey'
  `);
  if (valores.some((x) => x.v === 'SALES_TEAMS')) {
    salto.push('ModuleKey.SALES_TEAMS ya existía');
  } else {
    // Fuera de transacción: Postgres no deja usar un valor de enum recién
    // creado dentro de la misma transacción que lo creó.
    await ejecutar(
      'ModuleKey += SALES_TEAMS',
      `ALTER TYPE "ModuleKey" ADD VALUE IF NOT EXISTS 'SALES_TEAMS'`,
    );
  }

  // ── 2. El equipo, ahora de una marca ──────────────────────────────────
  for (const [col, tipo] of [
    ['whiteLabelId', 'TEXT'],
    ['slug', 'TEXT'],
    ['isActive', 'BOOLEAN NOT NULL DEFAULT true'],
    ['bookingConfig', `JSONB NOT NULL DEFAULT '{}'`],
    ['color', 'TEXT'],
    ['updatedAt', 'TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP'],
  ]) {
    if (await columnaExiste('SalesTeam', col)) {
      salto.push(`SalesTeam.${col} ya existía`);
      continue;
    }
    await ejecutar(
      `SalesTeam.${col}`,
      `ALTER TABLE "SalesTeam" ADD COLUMN IF NOT EXISTS "${col}" ${tipo}`,
    );
  }
  await ejecutar(
    'índices de SalesTeam',
    `CREATE INDEX IF NOT EXISTS "SalesTeam_whiteLabelId_idx" ON "SalesTeam"("whiteLabelId");
     CREATE UNIQUE INDEX IF NOT EXISTS "SalesTeam_slug_key" ON "SalesTeam"("slug") WHERE "slug" IS NOT NULL`,
  );

  for (const [col, tipo] of [
    ['roles', `TEXT[] NOT NULL DEFAULT '{}'`],
    ['isActive', 'BOOLEAN NOT NULL DEFAULT true'],
  ]) {
    if (await columnaExiste('SalesTeamMember', col)) {
      salto.push(`SalesTeamMember.${col} ya existía`);
      continue;
    }
    await ejecutar(
      `SalesTeamMember.${col}`,
      `ALTER TABLE "SalesTeamMember" ADD COLUMN IF NOT EXISTS "${col}" ${tipo}`,
    );
  }

  // ── 3. Las tablas nuevas ──────────────────────────────────────────────
  const TABLAS = {
    SalesStage: `
      CREATE TABLE IF NOT EXISTS "SalesStage" (
        "id" TEXT NOT NULL, "salesTeamId" TEXT NOT NULL,
        "name" TEXT NOT NULL, "kind" TEXT, "position" INTEGER NOT NULL DEFAULT 0,
        "color" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "SalesStage_pkey" PRIMARY KEY ("id")
      );
      CREATE INDEX IF NOT EXISTS "SalesStage_salesTeamId_position_idx" ON "SalesStage"("salesTeamId","position")`,

    SalesLead: `
      CREATE TABLE IF NOT EXISTS "SalesLead" (
        "id" TEXT NOT NULL, "salesTeamId" TEXT NOT NULL, "whiteLabelId" TEXT,
        "stageId" TEXT NOT NULL, "assignedUserId" TEXT, "createdByUserId" TEXT,
        "mktContactId" TEXT,
        "name" TEXT, "phone" TEXT, "phoneKey" TEXT, "email" TEXT,
        "instagram" TEXT, "company" TEXT, "source" TEXT,
        "value" DECIMAL(12,2), "tags" TEXT[] NOT NULL DEFAULT '{}',
        "lostReason" TEXT, "wonAt" TIMESTAMP(3),
        "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "SalesLead_pkey" PRIMARY KEY ("id")
      );
      CREATE INDEX IF NOT EXISTS "SalesLead_salesTeamId_stageId_idx" ON "SalesLead"("salesTeamId","stageId");
      CREATE INDEX IF NOT EXISTS "SalesLead_salesTeamId_assignedUserId_idx" ON "SalesLead"("salesTeamId","assignedUserId");
      CREATE INDEX IF NOT EXISTS "SalesLead_whiteLabelId_phoneKey_idx" ON "SalesLead"("whiteLabelId","phoneKey");
      CREATE INDEX IF NOT EXISTS "SalesLead_mktContactId_idx" ON "SalesLead"("mktContactId")`,

    SalesLeadActivity: `
      CREATE TABLE IF NOT EXISTS "SalesLeadActivity" (
        "id" TEXT NOT NULL, "leadId" TEXT NOT NULL, "salesTeamId" TEXT NOT NULL,
        "userId" TEXT, "kind" TEXT NOT NULL, "body" TEXT,
        "meta" JSONB NOT NULL DEFAULT '{}',
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "SalesLeadActivity_pkey" PRIMARY KEY ("id")
      );
      CREATE INDEX IF NOT EXISTS "SalesLeadActivity_leadId_createdAt_idx" ON "SalesLeadActivity"("leadId","createdAt")`,

    SalesFollowup: `
      CREATE TABLE IF NOT EXISTS "SalesFollowup" (
        "id" TEXT NOT NULL, "leadId" TEXT NOT NULL, "salesTeamId" TEXT NOT NULL,
        "assignedUserId" TEXT, "dueAt" TIMESTAMP(3) NOT NULL,
        "channel" TEXT, "note" TEXT,
        "done" BOOLEAN NOT NULL DEFAULT false, "doneAt" TIMESTAMP(3),
        "outcome" TEXT,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "SalesFollowup_pkey" PRIMARY KEY ("id")
      );
      CREATE INDEX IF NOT EXISTS "SalesFollowup_salesTeamId_dueAt_done_idx" ON "SalesFollowup"("salesTeamId","dueAt","done")`,

    SalesMeeting: `
      CREATE TABLE IF NOT EXISTS "SalesMeeting" (
        "id" TEXT NOT NULL, "salesTeamId" TEXT NOT NULL, "leadId" TEXT,
        "hostUserId" TEXT, "startAt" TIMESTAMP(3) NOT NULL,
        "durationMin" INTEGER NOT NULL DEFAULT 30, "timezone" TEXT,
        "status" TEXT NOT NULL DEFAULT 'PENDIENTE',
        "manageToken" TEXT NOT NULL, "notes" TEXT,
        "reminderSentAt" TIMESTAMP(3),
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "SalesMeeting_pkey" PRIMARY KEY ("id")
      );
      CREATE UNIQUE INDEX IF NOT EXISTS "SalesMeeting_manageToken_key" ON "SalesMeeting"("manageToken");
      CREATE INDEX IF NOT EXISTS "SalesMeeting_salesTeamId_startAt_idx" ON "SalesMeeting"("salesTeamId","startAt");
      CREATE INDEX IF NOT EXISTS "SalesMeeting_hostUserId_startAt_idx" ON "SalesMeeting"("hostUserId","startAt")`,

    SalesAvailability: `
      CREATE TABLE IF NOT EXISTS "SalesAvailability" (
        "id" TEXT NOT NULL, "salesTeamId" TEXT NOT NULL, "userId" TEXT,
        "weekday" INTEGER NOT NULL, "startMin" INTEGER NOT NULL, "endMin" INTEGER NOT NULL,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "SalesAvailability_pkey" PRIMARY KEY ("id")
      );
      CREATE INDEX IF NOT EXISTS "SalesAvailability_salesTeamId_weekday_idx" ON "SalesAvailability"("salesTeamId","weekday")`,

    SalesMessage: `
      CREATE TABLE IF NOT EXISTS "SalesMessage" (
        "id" TEXT NOT NULL, "salesTeamId" TEXT NOT NULL, "leadId" TEXT NOT NULL,
        "direction" TEXT NOT NULL, "channel" TEXT NOT NULL,
        "body" TEXT, "userId" TEXT, "providerMessageId" TEXT,
        "status" TEXT,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "SalesMessage_pkey" PRIMARY KEY ("id")
      );
      CREATE INDEX IF NOT EXISTS "SalesMessage_leadId_createdAt_idx" ON "SalesMessage"("leadId","createdAt");
      CREATE INDEX IF NOT EXISTS "SalesMessage_providerMessageId_idx" ON "SalesMessage"("providerMessageId")`,
  };

  for (const [nombre, sql] of Object.entries(TABLAS)) {
    if (await tablaExiste(nombre)) {
      salto.push(`tabla ${nombre} ya existía`);
      continue;
    }
    await ejecutar(`tabla ${nombre}`, sql);
  }

  // Claves foráneas: Postgres no tiene `ADD CONSTRAINT IF NOT EXISTS`.
  const FKS = [
    ['SalesTeam_whiteLabelId_fkey', `ALTER TABLE "SalesTeam" ADD CONSTRAINT "SalesTeam_whiteLabelId_fkey" FOREIGN KEY ("whiteLabelId") REFERENCES "WhiteLabel"("id") ON DELETE SET NULL ON UPDATE CASCADE`],
    ['SalesStage_salesTeamId_fkey', `ALTER TABLE "SalesStage" ADD CONSTRAINT "SalesStage_salesTeamId_fkey" FOREIGN KEY ("salesTeamId") REFERENCES "SalesTeam"("id") ON DELETE CASCADE ON UPDATE CASCADE`],
    // Restrict a propósito: borrar una etapa con leads dentro los dejaría
    // huérfanos. Primero se mueven, después se borra.
    ['SalesLead_stageId_fkey', `ALTER TABLE "SalesLead" ADD CONSTRAINT "SalesLead_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "SalesStage"("id") ON DELETE RESTRICT ON UPDATE CASCADE`],
    ['SalesLead_salesTeamId_fkey', `ALTER TABLE "SalesLead" ADD CONSTRAINT "SalesLead_salesTeamId_fkey" FOREIGN KEY ("salesTeamId") REFERENCES "SalesTeam"("id") ON DELETE CASCADE ON UPDATE CASCADE`],
    // SetNull y no Cascade: que se vaya un vendedor no puede borrar sus leads.
    ['SalesLead_assignedUserId_fkey', `ALTER TABLE "SalesLead" ADD CONSTRAINT "SalesLead_assignedUserId_fkey" FOREIGN KEY ("assignedUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE`],
    ['SalesLeadActivity_leadId_fkey', `ALTER TABLE "SalesLeadActivity" ADD CONSTRAINT "SalesLeadActivity_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "SalesLead"("id") ON DELETE CASCADE ON UPDATE CASCADE`],
    ['SalesFollowup_leadId_fkey', `ALTER TABLE "SalesFollowup" ADD CONSTRAINT "SalesFollowup_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "SalesLead"("id") ON DELETE CASCADE ON UPDATE CASCADE`],
    ['SalesMeeting_salesTeamId_fkey', `ALTER TABLE "SalesMeeting" ADD CONSTRAINT "SalesMeeting_salesTeamId_fkey" FOREIGN KEY ("salesTeamId") REFERENCES "SalesTeam"("id") ON DELETE CASCADE ON UPDATE CASCADE`],
    ['SalesMeeting_leadId_fkey', `ALTER TABLE "SalesMeeting" ADD CONSTRAINT "SalesMeeting_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "SalesLead"("id") ON DELETE SET NULL ON UPDATE CASCADE`],
    ['SalesAvailability_salesTeamId_fkey', `ALTER TABLE "SalesAvailability" ADD CONSTRAINT "SalesAvailability_salesTeamId_fkey" FOREIGN KEY ("salesTeamId") REFERENCES "SalesTeam"("id") ON DELETE CASCADE ON UPDATE CASCADE`],
    ['SalesMessage_leadId_fkey', `ALTER TABLE "SalesMessage" ADD CONSTRAINT "SalesMessage_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "SalesLead"("id") ON DELETE CASCADE ON UPDATE CASCADE`],
  ];
  for (const [nombre, sql] of FKS) {
    const [{ existe }] = await p.$queryRawUnsafe(
      `SELECT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = '${nombre}') AS existe`,
    );
    if (existe) {
      salto.push(`FK ${nombre} ya existía`);
      continue;
    }
    await ejecutar(`FK ${nombre}`, sql);
  }

  // ── 4. La marca de los equipos que ya existen ─────────────────────────
  // Misma deducción que hace hoy el servicio: la marca del código de referido
  // del líder. Solo se rellena cuando es inequívoca; lo demás se informa y se
  // deja en null, que es más honesto que adivinar.
  const equipos = await p.$queryRawUnsafe(`
    SELECT t.id, t.name, t."whiteLabelId",
           (SELECT array_agg(DISTINCT rc."whiteLabelId")
              FROM "ReferralCode" rc
             WHERE rc."ownerUserId" = t."leadUserId"
               AND rc."whiteLabelId" IS NOT NULL) AS marcas
      FROM "SalesTeam" t
  `);
  let resueltos = 0;
  let ambiguos = 0;
  for (const e of equipos) {
    if (e.whiteLabelId) continue;
    const marcas = (e.marcas ?? []).filter(Boolean);
    if (marcas.length === 1) {
      await p.$executeRawUnsafe(
        `UPDATE "SalesTeam" SET "whiteLabelId" = $1 WHERE id = $2`,
        marcas[0],
        e.id,
      );
      resueltos++;
    } else {
      ambiguos++;
      console.log(`  · «${e.name}»: ${marcas.length} marca(s) — se deja sin marca`);
    }
  }

  // ── Informe ───────────────────────────────────────────────────────────
  console.log(`\nAplicado (${hizo.length}):`);
  for (const x of hizo) console.log(`  ✓ ${x}`);
  if (salto.length) {
    console.log(`\nYa estaba (${salto.length}) — el script es idempotente.`);
  }

  const [{ n: nEquipos }] = await p.$queryRawUnsafe(
    `SELECT COUNT(*)::int AS n FROM "SalesTeam"`,
  );
  console.log(`\nEquipos: ${nEquipos} · con marca resuelta: ${resueltos} · ambiguos: ${ambiguos}`);
  for (const t of Object.keys(TABLAS)) {
    const [{ n }] = await p.$queryRawUnsafe(`SELECT COUNT(*)::int AS n FROM "${t}"`);
    console.log(`  ${t.padEnd(20)} ${n} fila(s)${n === 0 ? '  ✓ vacía, como debe ser' : '  ⚠ revisar'}`);
  }
  const [{ n: marcasCon }] = await p.$queryRawUnsafe(
    `SELECT COUNT(*)::int AS n FROM "WhiteLabelModule" WHERE module = 'SALES_TEAMS' AND enabled = true`,
  );
  console.log(`\nMarcas con el módulo encendido: ${marcasCon}`);
  console.log(marcasCon === 0 ? '  ✓ Nadie lo ve todavía.' : '  ⚠ Alguien ya lo tiene.');

  await p.$disconnect();
})().catch(async (e) => {
  console.error('Falló:', e.message);
  await p.$disconnect();
  process.exit(1);
});
