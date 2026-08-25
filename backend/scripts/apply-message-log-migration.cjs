/**
 * Migración ADITIVA: crea la tabla `MessageLog` — el historial de envíos.
 *
 * Registra todo mensaje que sale por Grow Business (SMS, WhatsApp y correo)
 * desde `GrowBusinessService.postChannelMessage`, que es el único punto por el
 * que pasan los tres canales.
 *
 * Aditiva e idempotente: `CREATE TABLE IF NOT EXISTS` + índices con
 * `IF NOT EXISTS`. No toca ninguna tabla existente y se puede correr las veces
 * que haga falta. NUNCA usar `prisma db push` contra producción.
 *
 * Uso:  railway run node scripts/apply-message-log-migration.cjs
 */
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

(async () => {
  const [existe] = await p.$queryRawUnsafe(`
    SELECT COUNT(*)::int AS n FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = 'MessageLog'`);

  if (existe.n) {
    console.log('La tabla "MessageLog" ya existe. Verifico los índices…');
  } else {
    console.log('Creando la tabla "MessageLog"…');
  }

  await p.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "MessageLog" (
      "id"                TEXT PRIMARY KEY,
      "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "channel"           TEXT NOT NULL,
      "status"            TEXT NOT NULL,
      "locationId"        TEXT NOT NULL,
      "whiteLabelId"      TEXT,
      "tenantId"          TEXT,
      "toPhone"           TEXT,
      "toEmail"           TEXT,
      "subject"           TEXT,
      "preview"           TEXT,
      "templateId"        TEXT,
      "feature"           TEXT,
      "providerMessageId" TEXT,
      "error"             TEXT
    )`);

  // Sin claves foráneas a propósito: es un registro histórico. Si un negocio o
  // una marca se borra, el historial de lo que se le mandó debe sobrevivir —
  // es justo cuando más se consulta.
  const indices = [
    ['MessageLog_whiteLabelId_createdAt_idx', '"whiteLabelId", "createdAt"'],
    ['MessageLog_tenantId_createdAt_idx', '"tenantId", "createdAt"'],
    ['MessageLog_status_createdAt_idx', '"status", "createdAt"'],
    ['MessageLog_templateId_createdAt_idx', '"templateId", "createdAt"'],
    ['MessageLog_createdAt_idx', '"createdAt"'],
  ];
  for (const [nombre, cols] of indices) {
    await p.$executeRawUnsafe(
      `CREATE INDEX IF NOT EXISTS "${nombre}" ON "MessageLog" (${cols})`,
    );
  }

  const cols = await p.$queryRawUnsafe(`
    SELECT column_name, data_type, is_nullable FROM information_schema.columns
     WHERE table_name = 'MessageLog' ORDER BY ordinal_position`);
  console.log(`\nColumnas (${cols.length}):`);
  for (const c of cols) {
    console.log(
      `  ${c.column_name.padEnd(20)} ${c.data_type.padEnd(28)} ${c.is_nullable === 'YES' ? 'nullable' : 'obligatoria'}`,
    );
  }

  const idx = await p.$queryRawUnsafe(`
    SELECT indexname FROM pg_indexes WHERE tablename = 'MessageLog' ORDER BY indexname`);
  console.log(`\nÍndices (${idx.length}): ${idx.map((i) => i.indexname).join(', ')}`);

  const [n] = await p.$queryRawUnsafe(`SELECT COUNT(*)::int AS n FROM "MessageLog"`);
  console.log(`\nFilas actuales: ${n.n}`);
  console.log('Listo. Nada más de la base fue tocado.');

  await p.$disconnect();
})().catch(async (e) => {
  console.error('FALLÓ:', e.message);
  await p.$disconnect();
  process.exit(1);
});
