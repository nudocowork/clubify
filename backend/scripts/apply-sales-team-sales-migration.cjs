/**
 * «Venta del equipo»: el lead ganado, vinculado al negocio de la marca en que se
 * convirtió, con su closer y su setter.
 *
 * Aditiva e idempotente: una tabla nueva, una columna nullable en
 * "SalesMeeting", sus índices y su clave foránea. No cambia ni borra ninguna
 * fila existente, y no siembra nada. Nunca `prisma db push`.
 *
 * POR QUÉ EXISTE
 * --------------
 * Un lead ganado no sabía en qué NEGOCIO se convirtió, así que una venta cerrada
 * por un equipo no se podía enganchar con el cobro. Esto guarda ese vínculo, con
 * quién cerró (closer) y quién agendó la cita (setter), para que el motor de
 * comisiones lo use después. Esta migración NO paga nada.
 *
 * LO QUE NO SE PUEDE ROMPER
 * -------------------------
 * · Los dos índices únicos son PARCIALES (solo las filas `vinculada`): un lead
 *   tiene un negocio y un negocio una venta MIENTRAS estén vinculados.
 *   Desvincular deja la fila con estado `desvinculada` —el historial de quién
 *   vinculó y cuándo no se borra— y libera al negocio para otra venta. Prisma no
 *   sabe expresar un único parcial: por eso vive aquí y el esquema solo declara
 *   los índices normales.
 * · `negocioId` es `Tenant.id` SIN clave foránea y sin llamarse `tenantId`:
 *   `prisma-tenant-middleware.ts` filtra por negocio TODO modelo que tenga un
 *   campo con ese nombre, y una venta de un equipo de marca quedaría escondida.
 * · Tampoco hay clave foránea al equipo: borrar un equipo no puede llevarse por
 *   delante el registro de una venta ya cerrada, que es lo que luego se paga.
 * · `leadId` sí apunta a "SalesLead" con ON DELETE SET NULL, como
 *   `SalesImplementation`: borrar un lead no borra la venta.
 * · `SalesMeeting.agendadaPorUserId` se rellena de aquí en adelante
 *   (`crearCita`). Las citas de antes se quedan en NULL: nadie guardó quién las
 *   agendó, y rellenarlo a ojo sería atribuirle una venta a alguien.
 *
 * Uso:  railway run --service Postgres-Nq8w node scripts/apply-sales-team-sales-migration.cjs [--aplicar]
 */
const { PrismaClient } = require('@prisma/client');

const APLICAR = process.argv.includes('--aplicar');
const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
const p = new PrismaClient({ datasources: { db: { url } } });

const TABLA = `CREATE TABLE IF NOT EXISTS "SalesTeamSale" (
  "id" TEXT NOT NULL,
  "salesTeamId" TEXT NOT NULL,
  "whiteLabelId" TEXT NOT NULL,
  "leadId" TEXT,
  "negocioId" TEXT NOT NULL,
  "closerUserId" TEXT,
  "closerCodeId" TEXT,
  "setterUserId" TEXT,
  "setterCodeId" TEXT,
  "pagaRenovaciones" BOOLEAN NOT NULL DEFAULT false,
  "estado" TEXT NOT NULL DEFAULT 'vinculada',
  "vinculadaPorUserId" TEXT,
  "vinculadaEl" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "desvinculadaPorUserId" TEXT,
  "desvinculadaEl" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SalesTeamSale_pkey" PRIMARY KEY ("id")
)`;

const COLUMNA = `ALTER TABLE "SalesMeeting" ADD COLUMN IF NOT EXISTS "agendadaPorUserId" TEXT`;

// Con los nombres que les pone Prisma, para que el esquema y la base no difieran.
const INDICES = [
  [
    'SalesTeamSale_salesTeamId_estado_idx',
    `CREATE INDEX IF NOT EXISTS "SalesTeamSale_salesTeamId_estado_idx" ON "SalesTeamSale"("salesTeamId","estado")`,
  ],
  ['SalesTeamSale_whiteLabelId_idx', `CREATE INDEX IF NOT EXISTS "SalesTeamSale_whiteLabelId_idx" ON "SalesTeamSale"("whiteLabelId")`],
  ['SalesTeamSale_negocioId_idx', `CREATE INDEX IF NOT EXISTS "SalesTeamSale_negocioId_idx" ON "SalesTeamSale"("negocioId")`],
  ['SalesTeamSale_leadId_idx', `CREATE INDEX IF NOT EXISTS "SalesTeamSale_leadId_idx" ON "SalesTeamSale"("leadId")`],
  // Los ÚNICOS PARCIALES: solo entre las vinculadas (ver la cabecera).
  [
    'SalesTeamSale_leadId_vinculada_key',
    `CREATE UNIQUE INDEX IF NOT EXISTS "SalesTeamSale_leadId_vinculada_key" ON "SalesTeamSale"("leadId") WHERE "estado" = 'vinculada' AND "leadId" IS NOT NULL`,
  ],
  [
    'SalesTeamSale_negocioId_vinculada_key',
    `CREATE UNIQUE INDEX IF NOT EXISTS "SalesTeamSale_negocioId_vinculada_key" ON "SalesTeamSale"("negocioId") WHERE "estado" = 'vinculada'`,
  ],
];

const FKS = [
  [
    'SalesTeamSale_leadId_fkey',
    `ALTER TABLE "SalesTeamSale" ADD CONSTRAINT "SalesTeamSale_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "SalesLead"("id") ON DELETE SET NULL ON UPDATE CASCADE`,
  ],
];

(async () => {
  if (!url) {
    console.error('No DATABASE_URL');
    process.exit(1);
  }
  console.log(APLICAR ? '*** APLICANDO ***' : 'ENSAYO (no escribe nada)');

  const si = async (sql, ...args) => (await p.$queryRawUnsafe(sql, ...args))[0].x;
  const hayTabla = (t) => si(`SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = $1) AS x`, t);
  const hayColumna = (t, c) =>
    si(`SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = $1 AND column_name = $2) AS x`, t, c);
  const hayIndice = (n) => si(`SELECT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = $1) AS x`, n);
  const hayClave = (n) => si(`SELECT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = $1) AS x`, n);

  for (const t of ['SalesTeam', 'SalesLead', 'SalesMeeting']) {
    if (!(await hayTabla(t))) {
      console.error(`Falta la tabla ${t}: aplica antes las migraciones de Equipos de Ventas.`);
      await p.$disconnect();
      process.exit(1);
    }
  }

  const tablaExiste = await hayTabla('SalesTeamSale');
  const columnaExiste = await hayColumna('SalesMeeting', 'agendadaPorUserId');
  console.log(`tabla SalesTeamSale ya existía: ${tablaExiste}`);
  console.log(`columna SalesMeeting.agendadaPorUserId ya existía: ${columnaExiste}`);

  // La tabla y la columna, si faltan; cada índice y cada clave, si falta ÉL: una
  // pasada cortada a medias no puede dejar producción sin ellos.
  const sentencias = [];
  if (!tablaExiste) sentencias.push(TABLA);
  if (!columnaExiste) sentencias.push(COLUMNA);
  for (const [nombre, sql] of INDICES) if (!(await hayIndice(nombre))) sentencias.push(sql);
  for (const [nombre, sql] of FKS) if (!(await hayClave(nombre))) sentencias.push(sql);

  if (!APLICAR) {
    for (const s of sentencias) console.log(`   ${s.replace(/\s+/g, ' ')};`);
    console.log(sentencias.length ? '\n-- ENSAYO. Con --aplicar se ejecuta lo de arriba.' : '\n-- Nada que hacer.');
    await p.$disconnect();
    return;
  }

  for (const s of sentencias) {
    try {
      // `lock_timeout`: si otra cosa tiene tomada la tabla, esto se rinde en 5 s
      // en vez de quedarse esperando con la cola detrás.
      await p.$transaction([p.$executeRawUnsafe(`SET LOCAL lock_timeout = '5s'`), p.$executeRawUnsafe(s)]);
    } catch (e) {
      console.error(`falló: ${s.replace(/\s+/g, ' ').slice(0, 120)}`);
      console.error(e.message);
      await p.$disconnect();
      process.exit(1);
    }
    console.log(`  ✓ ${s.replace(/\s+/g, ' ').slice(0, 90)}…`);
  }

  // Releer: una escritura no está hecha hasta que se comprueba en otra consulta.
  const listo =
    (await hayTabla('SalesTeamSale')) &&
    (await hayColumna('SalesMeeting', 'agendadaPorUserId')) &&
    (await hayIndice('SalesTeamSale_leadId_vinculada_key')) &&
    (await hayIndice('SalesTeamSale_negocioId_vinculada_key')) &&
    (await hayClave('SalesTeamSale_leadId_fkey'));
  const ventas = listo ? await si(`SELECT COUNT(*)::int AS x FROM "SalesTeamSale"`) : 0;
  console.log(`listo · tabla, columna, únicos parciales y clave foránea: ${listo ? 'sí' : 'NO'} · ventas: ${ventas}`);
  if (!listo) process.exit(1);
  await p.$disconnect();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
