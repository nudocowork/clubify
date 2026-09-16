/**
 * «Conexión de Calendario / Correo» de los equipos de ventas.
 *
 * Aditiva e idempotente: una tabla vacía (la cuenta de Google de cada equipo),
 * su índice único, su clave foránea y cuatro columnas NULLABLE en "SalesMeeting".
 * No toca ninguna fila existente. Nunca `prisma db push`.
 *
 * ORDEN: ANTES de desplegar el backend. Prisma pide todas las columnas de la
 * cita en cada consulta sin `select`: con el código nuevo y sin estas columnas,
 * el Banco y la Agenda dan 500.
 *
 * LO QUE NO SE PUEDE ROMPER
 * -------------------------
 * · Sin columna `tenantId`: el middleware filtraría la tabla por negocio y los
 *   equipos son de MARCA.
 * · Un equipo, una conexión (índice único sobre "salesTeamId"). Borrar el equipo
 *   se lleva su conexión (CASCADE).
 * · Los tokens se guardan cifrados (`enc:v1:`) por el backend; aquí solo hay TEXT.
 *
 * Uso:  railway run --service Postgres-Nq8w node scripts/apply-sales-calendar-migration.cjs [--aplicar]
 */
const { PrismaClient } = require('@prisma/client');

const APLICAR = process.argv.includes('--aplicar');
const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
const p = new PrismaClient({ datasources: { db: { url } } });

const TABLAS = {
  SalesCalendarConnection: [
    `CREATE TABLE IF NOT EXISTS "SalesCalendarConnection" (
       "id" TEXT NOT NULL, "salesTeamId" TEXT NOT NULL,
       "provider" TEXT NOT NULL DEFAULT 'google', "email" TEXT,
       "accessToken" TEXT, "refreshToken" TEXT, "expiresAt" TIMESTAMP(3), "scope" TEXT,
       "calendarId" TEXT NOT NULL DEFAULT 'primary', "colorId" TEXT,
       "autoMeet" BOOLEAN NOT NULL DEFAULT true, "inviteLead" BOOLEAN NOT NULL DEFAULT true,
       "inviteCloser" BOOLEAN NOT NULL DEFAULT true, "sendUpdates" BOOLEAN NOT NULL DEFAULT true,
       "active" BOOLEAN NOT NULL DEFAULT false, "connectedByUserId" TEXT,
       "connectedAt" TIMESTAMP(3), "lastSyncAt" TIMESTAMP(3), "lastError" TEXT,
       "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
       "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
       CONSTRAINT "SalesCalendarConnection_pkey" PRIMARY KEY ("id")
     )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS "SalesCalendarConnection_salesTeamId_key" ON "SalesCalendarConnection"("salesTeamId")`,
  ],
};

const FKS = [
  ['SalesCalendarConnection_salesTeamId_fkey', `ALTER TABLE "SalesCalendarConnection" ADD CONSTRAINT "SalesCalendarConnection_salesTeamId_fkey" FOREIGN KEY ("salesTeamId") REFERENCES "SalesTeam"("id") ON DELETE CASCADE ON UPDATE CASCADE`],
];

/** La sala y el evento viven en la cita: reasignar el closer no los cambia. */
const COLUMNAS = [
  ['SalesMeeting', 'meetUrl', 'TEXT'],
  ['SalesMeeting', 'gcalEventId', 'TEXT'],
  ['SalesMeeting', 'gcalCalendarId', 'TEXT'],
  ['SalesMeeting', 'gcalError', 'TEXT'],
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
    // después de crear la tabla no puede dejar producción sin su índice único.
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
  for (const [tabla, columna, tipo] of COLUMNAS) {
    const [{ hay }] = await p.$queryRawUnsafe(
      `SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = $1 AND column_name = $2) AS hay`,
      tabla,
      columna,
    );
    console.log(`columna ${tabla}.${columna} ya existía: ${hay}`);
    if (!hay) sentencias.push(`ALTER TABLE "${tabla}" ADD COLUMN IF NOT EXISTS "${columna}" ${tipo}`);
  }

  if (!APLICAR) {
    for (const s of sentencias) console.log(`   ${s.replace(/\s+/g, ' ')};`);
    console.log(sentencias.length ? '\n-- ENSAYO. Con --aplicar se ejecuta lo de arriba.' : '\n-- Nada que hacer.');
    await p.$disconnect();
    return;
  }
  for (const s of sentencias) {
    // Con tope de espera por el candado. `ALTER TABLE "SalesMeeting"` pide un
    // candado exclusivo: si una consulta larga lo retiene, la sentencia se queda
    // esperando y detrás de ella se bloquea TODO lo que lea citas (el Banco, la
    // Agenda, la reserva pública). Mejor fallar a los 5 s y repetir, que es
    // idempotente. `SET LOCAL` en la misma transacción que la sentencia: con la
    // reserva de conexiones de Prisma, un `SET` suelto puede caer en otra conexión.
    try {
      await p.$transaction([p.$executeRawUnsafe(`SET LOCAL lock_timeout = '5s'`), p.$executeRawUnsafe(s)]);
    } catch (e) {
      if (/lock timeout/i.test(String(e && e.message))) {
        console.error(
          `No se consiguió el candado en 5 s para: ${s.replace(/\s+/g, ' ').slice(0, 90)}…\n` +
            'Algo está usando esa tabla. Vuelve a pasar la migración en un rato: es idempotente.',
        );
        await p.$disconnect();
        process.exit(1);
      }
      throw e;
    }
    console.log(`  ✓ ${s.replace(/\s+/g, ' ').slice(0, 90)}…`);
  }
  const [{ n }] = await p.$queryRawUnsafe(`SELECT COUNT(*)::int AS n FROM "SalesCalendarConnection"`);
  console.log(`listo · SalesCalendarConnection: ${n} filas`);
  await p.$disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
