/**
 * Varias agendas de reserva por equipo («Agendas de reserva del equipo»).
 *
 * Aditiva e idempotente: una tabla nueva, una columna nullable en
 * "SalesMeeting", sus índices y claves foráneas, y la siembra. No cambia ni
 * borra ninguna fila existente. Nunca `prisma db push`.
 *
 * POR QUÉ EXISTE
 * --------------
 * En TeamClubify un equipo tiene varias agendas públicas, cada una con su enlace,
 * su horario y su formulario («Agenda Clubify - Instagram»…), y lo que entra por
 * cualquiera cae al mismo banco. En Clubify PRO cada equipo tenía UNA:
 * `/agenda/<slug del equipo>`, con los ajustes en `SalesTeam.bookingConfig` y el
 * horario en `SalesAvailability` (las filas sin persona).
 *
 * LO QUE NO SE PUEDE ROMPER
 * -------------------------
 * · Los enlaces ya repartidos. Cada equipo CON enlace recibe una agenda con su
 *   MISMO slug, sus ajustes (`bookingConfig` tal cual, menos `formularioId`), su
 *   formulario y el horario del equipo. La lee la misma función que leía
 *   `bookingConfig` (`leerAjustesDeAgenda`), así que lo raro vuelve al valor por
 *   defecto igual que antes. No lleva `pasoMin` ni `cuposPorHorario`: por
 *   defecto valen 15 y 1, que es exactamente lo que hacía la agenda única.
 * · Un equipo SIN enlace no recibe agenda: no tenía nada público que conservar,
 *   y abrirle un enlace que nadie pidió es una puerta de más. Se listan abajo.
 * · Idempotente por equipo: se siembra solo al equipo que no tiene ninguna
 *   agenda, comprobado en la misma sentencia del alta. Pasarla dos veces no
 *   duplica nada.
 * · Lo que se cambie en la agenda vieja entre esta migración y el despliegue del
 *   backend nuevo NO se copia: aplícala justo antes de desplegar.
 * · Sin columna `tenantId`, como el resto de `Sales*`.
 *
 * Uso:  railway run --service Postgres-Nq8w node scripts/apply-sales-agendas-migration.cjs [--aplicar]
 */
const { randomUUID } = require('crypto');
const { PrismaClient } = require('@prisma/client');

const APLICAR = process.argv.includes('--aplicar');
const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
const p = new PrismaClient({ datasources: { db: { url } } });

const TABLA = `CREATE TABLE IF NOT EXISTS "SalesAgenda" (
  "id" TEXT NOT NULL, "salesTeamId" TEXT NOT NULL, "whiteLabelId" TEXT,
  "slug" TEXT NOT NULL, "name" TEXT NOT NULL, "color" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true, "formId" TEXT,
  "settings" JSONB NOT NULL DEFAULT '{}', "createdByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SalesAgenda_pkey" PRIMARY KEY ("id")
)`;

const COLUMNA = `ALTER TABLE "SalesMeeting" ADD COLUMN IF NOT EXISTS "agendaId" TEXT`;

// Con los nombres que les pone Prisma, para que el esquema y la base no difieran.
const INDICES = [
  ['SalesAgenda_slug_key', `CREATE UNIQUE INDEX IF NOT EXISTS "SalesAgenda_slug_key" ON "SalesAgenda"("slug")`],
  [
    'SalesAgenda_salesTeamId_createdAt_idx',
    `CREATE INDEX IF NOT EXISTS "SalesAgenda_salesTeamId_createdAt_idx" ON "SalesAgenda"("salesTeamId","createdAt")`,
  ],
  ['SalesMeeting_agendaId_idx', `CREATE INDEX IF NOT EXISTS "SalesMeeting_agendaId_idx" ON "SalesMeeting"("agendaId")`],
];

const FKS = [
  [
    'SalesAgenda_salesTeamId_fkey',
    `ALTER TABLE "SalesAgenda" ADD CONSTRAINT "SalesAgenda_salesTeamId_fkey" FOREIGN KEY ("salesTeamId") REFERENCES "SalesTeam"("id") ON DELETE CASCADE ON UPDATE CASCADE`,
  ],
  [
    'SalesAgenda_formId_fkey',
    `ALTER TABLE "SalesAgenda" ADD CONSTRAINT "SalesAgenda_formId_fkey" FOREIGN KEY ("formId") REFERENCES "SalesForm"("id") ON DELETE SET NULL ON UPDATE CASCADE`,
  ],
  [
    'SalesMeeting_agendaId_fkey',
    `ALTER TABLE "SalesMeeting" ADD CONSTRAINT "SalesMeeting_agendaId_fkey" FOREIGN KEY ("agendaId") REFERENCES "SalesAgenda"("id") ON DELETE SET NULL ON UPDATE CASCADE`,
  ],
];

const objeto = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});

/** La agenda que hereda un equipo: la misma que servía su enlace. */
function agendaSembrada(equipo, franjas, formularios) {
  const { formularioId, ...ajustes } = objeto(equipo.bookingConfig);
  // Solo si el formulario existe y es del equipo: si no, la clave foránea
  // tumbaría el alta. Si está inactivo se guarda igual; la agenda lo ignora al
  // leerlo, como hacía con `bookingConfig`.
  const formId =
    typeof formularioId === 'string' && formularios.has(`${equipo.id}:${formularioId}`) ? formularioId : null;
  const titulo = typeof ajustes.titulo === 'string' ? ajustes.titulo.trim().slice(0, 80) : '';
  return {
    id: randomUUID(),
    salesTeamId: equipo.id,
    whiteLabelId: equipo.whiteLabelId,
    slug: equipo.slug,
    // El nombre es el de la lista de «Configuración»; el título público sigue en los ajustes.
    name: titulo || 'Agenda principal',
    formId,
    settings: {
      ...ajustes,
      franjas: franjas
        .filter((f) => f.salesTeamId === equipo.id)
        .map((f) => ({ weekday: Number(f.weekday), startMin: Number(f.startMin), endMin: Number(f.endMin) })),
    },
  };
}

(async () => {
  if (!url) { console.error('No DATABASE_URL'); process.exit(1); }
  console.log(APLICAR ? '*** APLICANDO ***' : 'ENSAYO (no escribe nada)');

  const si = async (sql, ...args) => (await p.$queryRawUnsafe(sql, ...args))[0].x;
  const hayTabla = (t) => si(`SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = $1) AS x`, t);
  const hayColumna = (t, c) =>
    si(`SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = $1 AND column_name = $2) AS x`, t, c);
  const hayIndice = (n) => si(`SELECT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = $1) AS x`, n);
  const hayClave = (n) => si(`SELECT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = $1) AS x`, n);

  for (const t of ['SalesTeam', 'SalesMeeting', 'SalesAvailability', 'SalesForm']) {
    if (!(await hayTabla(t))) {
      console.error(`Falta la tabla ${t}: aplica antes las migraciones de Equipos de Ventas y la de Formularios.`);
      await p.$disconnect();
      process.exit(1);
    }
  }

  const tablaExiste = await hayTabla('SalesAgenda');
  const columnaExiste = await hayColumna('SalesMeeting', 'agendaId');
  console.log(`tabla SalesAgenda ya existía: ${tablaExiste}`);
  console.log(`columna SalesMeeting.agendaId ya existía: ${columnaExiste}`);

  // La tabla y la columna, si faltan; cada índice y cada clave, si falta ÉL: una
  // pasada cortada a medias no puede dejar producción sin ellos.
  const sentencias = [];
  if (!tablaExiste) sentencias.push(TABLA);
  if (!columnaExiste) sentencias.push(COLUMNA);
  for (const [nombre, sql] of INDICES) if (!(await hayIndice(nombre))) sentencias.push(sql);
  for (const [nombre, sql] of FKS) if (!(await hayClave(nombre))) sentencias.push(sql);

  // La siembra: los equipos con enlace que todavía no tienen ninguna agenda.
  const equipos = await p.$queryRawUnsafe(
    `SELECT t."id", t."name", t."slug", t."whiteLabelId", t."bookingConfig"
       FROM "SalesTeam" t
      WHERE t."slug" IS NOT NULL
        ${tablaExiste ? `AND NOT EXISTS (SELECT 1 FROM "SalesAgenda" a WHERE a."salesTeamId" = t."id")` : ''}
      ORDER BY t."createdAt"`,
  );
  const franjas = await p.$queryRawUnsafe(
    `SELECT "salesTeamId", "weekday", "startMin", "endMin" FROM "SalesAvailability"
      WHERE "userId" IS NULL ORDER BY "weekday", "startMin"`,
  );
  const formularios = new Set(
    (await p.$queryRawUnsafe(`SELECT "id", "salesTeamId" FROM "SalesForm"`)).map((f) => `${f.salesTeamId}:${f.id}`),
  );
  const sembrar = equipos.map((e) => agendaSembrada(e, franjas, formularios));
  const sinEnlace = await p.$queryRawUnsafe(
    `SELECT "id", "name", "bookingConfig" FROM "SalesTeam" WHERE "slug" IS NULL ORDER BY "createdAt"`,
  );

  const contarSinEnlace = () => {
    for (const t of sinEnlace) {
      const tenia = Object.keys(objeto(t.bookingConfig)).length ? ` · tenía ajustes ${JSON.stringify(t.bookingConfig)}` : '';
      console.log(`   sin enlace, no se siembra: «${t.name}» (${t.id})${tenia}`);
    }
  };

  if (!APLICAR) {
    for (const s of sentencias) console.log(`   ${s.replace(/\s+/g, ' ')};`);
    for (const a of sembrar) {
      console.log(
        `   sembraría «${a.name}» /agenda/${a.slug} · equipo ${a.salesTeamId} · formulario ${a.formId ?? '—'} · ` +
          `${a.settings.franjas.length} tramo(s) · ajustes ${JSON.stringify(a.settings)}`,
      );
    }
    contarSinEnlace();
    console.log(sentencias.length || sembrar.length ? '\n-- ENSAYO. Con --aplicar se ejecuta lo de arriba.' : '\n-- Nada que hacer.');
    await p.$disconnect();
    return;
  }

  for (const s of sentencias) {
    // Con tope de espera por el candado. `ALTER TABLE "SalesMeeting"` pide un
    // candado exclusivo: si una consulta larga lo retiene, la sentencia se queda
    // esperando y detrás de ella se bloquea TODO lo que lea citas. Mejor fallar a
    // los 5 s y repetir, que es idempotente. `SET LOCAL` en la misma transacción
    // que la sentencia: con la reserva de conexiones de Prisma, un `SET` suelto
    // puede caer en otra conexión y no valer para ella.
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

  let sembradas = 0;
  for (const a of sembrar) {
    // En UNA sentencia: si otra pasada sembró este equipo entre medias, el NOT
    // EXISTS lo ve y no inserta; si ese slug ya lo tiene otra agenda, tampoco.
    const n = await p.$executeRawUnsafe(
      `INSERT INTO "SalesAgenda" ("id","salesTeamId","whiteLabelId","slug","name","isActive","formId","settings","createdAt","updatedAt")
       SELECT $1::text, $2::text, $3::text, $4::text, $5::text, true, $6::text, $7::jsonb, NOW(), NOW()
        WHERE NOT EXISTS (SELECT 1 FROM "SalesAgenda" WHERE "salesTeamId" = $2::text)
       ON CONFLICT ("slug") DO NOTHING`,
      a.id,
      a.salesTeamId,
      a.whiteLabelId,
      a.slug,
      a.name,
      a.formId,
      JSON.stringify(a.settings),
    );
    if (n) sembradas++;
    console.log(`  ${n ? '✓' : '·'} «${a.name}» /agenda/${a.slug}${n ? '' : ' (no se insertó: ya tenía agenda o el enlace está tomado)'}`);
  }
  contarSinEnlace();
  const [{ total }] = await p.$queryRawUnsafe(`SELECT COUNT(*)::int AS total FROM "SalesAgenda"`);
  console.log(`listo · sembradas ahora: ${sembradas} · agendas en total: ${total} · equipos sin enlace: ${sinEnlace.length}`);
  await p.$disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
