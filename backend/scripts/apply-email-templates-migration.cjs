/**
 * Migración ADITIVA: plantillas de correo del editor visual.
 *
 *  - `MktEmailTemplate`        — la plantilla (bloques + HTML + miniatura)
 *  - `MktEmailTemplateFolder`  — carpetas, anidables
 *
 * Aditiva e idempotente (`CREATE TABLE/INDEX IF NOT EXISTS`). No toca ninguna
 * tabla existente. NUNCA usar `prisma db push` contra producción.
 *
 * Uso:  railway run node scripts/apply-email-templates-migration.cjs
 */
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

(async () => {
  console.log('1) Tabla "MktEmailTemplate"…');
  await p.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "MktEmailTemplate" (
      "id"           TEXT PRIMARY KEY,
      "whiteLabelId" TEXT NOT NULL,
      "folderId"     TEXT,
      "name"         TEXT NOT NULL,
      "subject"      TEXT,
      "blocks"       JSONB NOT NULL DEFAULT '[]',
      "html"         TEXT,
      "thumbnailUrl" TEXT,
      "isPreset"     BOOLEAN NOT NULL DEFAULT false,
      "createdBy"    TEXT,
      "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);

  console.log('2) Tabla "MktEmailTemplateFolder"…');
  await p.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "MktEmailTemplateFolder" (
      "id"           TEXT PRIMARY KEY,
      "whiteLabelId" TEXT NOT NULL,
      "name"         TEXT NOT NULL,
      "parentId"     TEXT,
      "position"     INTEGER NOT NULL DEFAULT 0,
      "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);

  // Sin claves foráneas: el árbol de carpetas se resuelve en código, para que
  // borrar una carpeta nunca arrastre su subárbol en cascada sin avisar.
  for (const [nombre, tabla, cols] of [
    ['MktEmailTemplate_whiteLabelId_updatedAt_idx', 'MktEmailTemplate', '"whiteLabelId", "updatedAt"'],
    ['MktEmailTemplate_folderId_idx', 'MktEmailTemplate', '"folderId"'],
    ['MktEmailTemplate_isPreset_idx', 'MktEmailTemplate', '"isPreset"'],
    ['MktEmailTemplateFolder_whiteLabelId_idx', 'MktEmailTemplateFolder', '"whiteLabelId"'],
    ['MktEmailTemplateFolder_parentId_idx', 'MktEmailTemplateFolder', '"parentId"'],
  ]) {
    await p.$executeRawUnsafe(
      `CREATE INDEX IF NOT EXISTS "${nombre}" ON "${tabla}" (${cols})`,
    );
  }

  for (const t of ['MktEmailTemplate', 'MktEmailTemplateFolder']) {
    const cols = await p.$queryRawUnsafe(`
      SELECT column_name FROM information_schema.columns
       WHERE table_name = $1 ORDER BY ordinal_position`, t);
    const [n] = await p.$queryRawUnsafe(`SELECT COUNT(*)::int AS n FROM "${t}"`);
    console.log(`\n${t}: ${cols.length} columnas, ${n.n} filas`);
    console.log(`  ${cols.map((c) => c.column_name).join(', ')}`);
  }

  console.log('\nListo. Ninguna tabla existente fue tocada.');
  await p.$disconnect();
})().catch(async (e) => {
  console.error('FALLÓ:', e.message);
  await p.$disconnect();
  process.exit(1);
});
