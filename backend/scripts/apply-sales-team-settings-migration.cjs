/**
 * «Configuración» de un equipo de ventas: descripción, estado y ajustes.
 *
 * Aditiva e idempotente: tres columnas nuevas en "SalesTeam" y un índice en
 * "SalesFormResponse". No borra nada. Nunca `prisma db push`.
 *
 * POR QUÉ EXISTE
 * --------------
 * TeamClubify tiene en cada equipo una pestaña «Configuración»: identidad
 * (nombre, descripción, responsable, estado activo/pausado/desactivado, color),
 * el mensaje de WhatsApp con el que el closer escribe al contacto, y cómo se ve
 * el Banco (nombre de cada pestaña y qué datos enseña una cita). En Clubify PRO
 * solo se podía cambiar el nombre y el líder, y solo desde la lista de equipos.
 *
 * LO QUE NO SE PUEDE ROMPER
 * -------------------------
 * · `isActive` se queda: el estado nuevo lo complementa. Un equipo que ya estaba
 *   inactivo entra como «desactivado», no como «activo». La columna y su relleno
 *   van en UNA transacción: si se cortara entre las dos, la siguiente pasada
 *   vería la columna y no rellenaría nunca.
 * · `settings` arranca en `{}`, que se lee como «lo de siempre» (mismos nombres
 *   del Banco, mismos datos, mensaje por defecto).
 * · El índice de `SalesFormResponse.meetingId` es para que el Banco lea las
 *   respuestas del formulario de sus citas sin recorrer la tabla. Necesita la
 *   migración de Formularios aplicada antes.
 *
 * Uso:  railway run --service Postgres-Nq8w node scripts/apply-sales-team-settings-migration.cjs [--aplicar]
 */
const { PrismaClient } = require('@prisma/client');

const APLICAR = process.argv.includes('--aplicar');
const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
const p = new PrismaClient({ datasources: { db: { url } } });

const COLUMNAS = [
  ['description', [`ALTER TABLE "SalesTeam" ADD COLUMN IF NOT EXISTS "description" TEXT`]],
  [
    'status',
    [
      `ALTER TABLE "SalesTeam" ADD COLUMN IF NOT EXISTS "status" TEXT NOT NULL DEFAULT 'activo'`,
      `UPDATE "SalesTeam" SET "status" = 'desactivado' WHERE "isActive" = false`,
    ],
  ],
  ['settings', [`ALTER TABLE "SalesTeam" ADD COLUMN IF NOT EXISTS "settings" JSONB NOT NULL DEFAULT '{}'`]],
];

const INDICES = [
  [
    'SalesFormResponse',
    'SalesFormResponse_meetingId_idx',
    `CREATE INDEX IF NOT EXISTS "SalesFormResponse_meetingId_idx" ON "SalesFormResponse"("meetingId")`,
  ],
];

(async () => {
  if (!url) { console.error('No DATABASE_URL'); process.exit(1); }
  console.log(APLICAR ? '*** APLICANDO ***' : 'ENSAYO (no escribe nada)');

  /** Cada entrada es un grupo que va en una transacción. */
  const grupos = [];
  for (const [columna, sql] of COLUMNAS) {
    const [{ existe }] = await p.$queryRawUnsafe(
      `SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'SalesTeam' AND column_name = $1) AS existe`,
      columna,
    );
    console.log(`columna SalesTeam.${columna} ya existía: ${existe}`);
    if (!existe) grupos.push(sql);
  }
  for (const [tabla, nombre, sql] of INDICES) {
    const [{ hayTabla }] = await p.$queryRawUnsafe(
      `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = $1) AS "hayTabla"`,
      tabla,
    );
    if (!hayTabla) {
      console.error(`Falta la tabla ${tabla}: aplica antes scripts/apply-sales-forms-migration.cjs`);
      await p.$disconnect();
      process.exit(1);
    }
    const [{ hay }] = await p.$queryRawUnsafe(
      `SELECT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = $1) AS hay`,
      nombre,
    );
    console.log(`índice ${nombre} ya existía: ${hay}`);
    if (!hay) grupos.push([sql]);
  }

  if (!APLICAR) {
    for (const g of grupos) for (const s of g) console.log(`   ${s.replace(/\s+/g, ' ')};`);
    console.log(grupos.length ? '\n-- ENSAYO. Con --aplicar se ejecuta lo de arriba.' : '\n-- Nada que hacer.');
    await p.$disconnect();
    return;
  }
  for (const g of grupos) {
    await p.$transaction(g.map((s) => p.$executeRawUnsafe(s)));
    for (const s of g) console.log(`  ✓ ${s.replace(/\s+/g, ' ').slice(0, 90)}…`);
  }
  const estados = await p.$queryRawUnsafe(
    `SELECT "status", "isActive", COUNT(*)::int AS n FROM "SalesTeam" GROUP BY 1, 2 ORDER BY 1, 2`,
  );
  console.log('listo · equipos por estado:', JSON.stringify(estados));
  await p.$disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
