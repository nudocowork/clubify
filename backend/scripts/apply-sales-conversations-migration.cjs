/**
 * «Conversaciones» de un equipo de ventas: la marca de leído y el índice de la bandeja.
 *
 * Aditiva e idempotente: una columna NULLABLE sin valor por defecto (en Postgres
 * es un cambio de metadatos, no reescribe la tabla) y un índice. No toca filas.
 * Nunca `prisma db push`.
 *
 * POR QUÉ EXISTE
 * --------------
 * TeamClubify tiene una bandeja de chats del equipo con «No leídos». En Clubify
 * PRO los mensajes ya se guardaban (`SalesMessage`) pero nada decía cuáles se
 * habían leído. `SalesLead.chatReadAt` es hasta cuándo se leyó la conversación:
 * lo que entró después cuenta como no leído.
 *
 * ORDEN QUE NO SE PUEDE SALTAR
 * ----------------------------
 * Aplicar ANTES de desplegar el backend que trae la columna en el esquema: Prisma
 * lee todas las columnas de `SalesLead` en cada consulta, y sin esta se caería
 * toda pantalla que lea un lead.
 *
 * Uso:  railway run --service Postgres-Nq8w node scripts/apply-sales-conversations-migration.cjs [--aplicar]
 */
const { PrismaClient } = require('@prisma/client');

const APLICAR = process.argv.includes('--aplicar');
const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
const p = new PrismaClient({ datasources: { db: { url } } });

const PASOS = [
  {
    nombre: 'columna SalesLead.chatReadAt',
    existe: `SELECT EXISTS (SELECT 1 FROM information_schema.columns
                             WHERE table_name = 'SalesLead' AND column_name = 'chatReadAt') AS existe`,
    sql: `ALTER TABLE "SalesLead" ADD COLUMN IF NOT EXISTS "chatReadAt" TIMESTAMP(3)`,
  },
  {
    nombre: 'índice de la bandeja',
    existe: `SELECT EXISTS (SELECT 1 FROM pg_indexes
                             WHERE indexname = 'SalesMessage_salesTeamId_leadId_createdAt_idx') AS existe`,
    sql: `CREATE INDEX IF NOT EXISTS "SalesMessage_salesTeamId_leadId_createdAt_idx"
            ON "SalesMessage"("salesTeamId", "leadId", "createdAt")`,
  },
];

(async () => {
  if (!url) { console.error('No DATABASE_URL'); process.exit(1); }
  console.log(APLICAR ? '*** APLICANDO ***' : 'ENSAYO (no escribe nada)');

  const pendientes = [];
  for (const paso of PASOS) {
    const [{ existe }] = await p.$queryRawUnsafe(paso.existe);
    console.log(`${paso.nombre} ya existía: ${existe}`);
    if (!existe) pendientes.push(paso);
  }

  if (!APLICAR) {
    for (const paso of pendientes) console.log(`   ${paso.sql.replace(/\s+/g, ' ')};`);
    console.log(pendientes.length ? '\n-- ENSAYO. Con --aplicar se ejecuta lo de arriba.' : '\n-- Nada que hacer.');
    await p.$disconnect();
    return;
  }
  for (const paso of pendientes) {
    await p.$executeRawUnsafe(paso.sql);
    console.log(`  ✓ ${paso.nombre}`);
  }
  const [{ n }] = await p.$queryRawUnsafe(`SELECT COUNT(*)::int AS n FROM "SalesMessage"`);
  console.log(`\nlisto · SalesMessage: ${n} filas`);
  await p.$disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
