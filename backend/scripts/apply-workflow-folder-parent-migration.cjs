/**
 * Migración ADITIVA: `BrandWorkflowFolder.parentId` — carpetas dentro de
 * carpetas, como en TeamClubify.
 *
 * Aditiva e idempotente: `ADD COLUMN IF NOT EXISTS` sobre una columna nullable
 * y `CREATE INDEX IF NOT EXISTS`. Toda carpeta existente queda con `parentId`
 * nulo, es decir en la raíz — exactamente donde está hoy. NUNCA usar
 * `prisma db push` contra producción.
 *
 * Uso:  railway run node scripts/apply-workflow-folder-parent-migration.cjs
 */
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

(async () => {
  const antes = await p.$queryRawUnsafe(`
    SELECT COUNT(*)::int AS n FROM information_schema.columns
     WHERE table_name = 'BrandWorkflowFolder' AND column_name = 'parentId'`);
  if (antes[0].n) {
    console.log('La columna "parentId" ya existe. Solo verifico el índice…');
  } else {
    console.log('Agregando BrandWorkflowFolder."parentId" (TEXT, nullable)…');
  }

  await p.$executeRawUnsafe(
    `ALTER TABLE "BrandWorkflowFolder" ADD COLUMN IF NOT EXISTS "parentId" TEXT`,
  );
  await p.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS "BrandWorkflowFolder_parentId_idx" ON "BrandWorkflowFolder" ("parentId")`,
  );

  const col = await p.$queryRawUnsafe(`
    SELECT column_name, data_type, is_nullable FROM information_schema.columns
     WHERE table_name = 'BrandWorkflowFolder' AND column_name = 'parentId'`);
  console.log('\nColumna →', col[0] ?? '(no se creó)');

  const idx = await p.$queryRawUnsafe(
    `SELECT indexname FROM pg_indexes WHERE tablename = 'BrandWorkflowFolder' ORDER BY indexname`,
  );
  console.log(`Índices → ${idx.map((i) => i.indexname).join(', ')}`);

  // Comprobación de que nadie se movió: todas las carpetas siguen en la raíz.
  const [t] = await p.$queryRawUnsafe(
    `SELECT COUNT(*)::int AS n FROM "BrandWorkflowFolder"`,
  );
  const [r] = await p.$queryRawUnsafe(
    `SELECT COUNT(*)::int AS n FROM "BrandWorkflowFolder" WHERE "parentId" IS NULL`,
  );
  console.log(`\nCarpetas: ${t.n} · en la raíz: ${r.n} (deben coincidir tras migrar)`);
  console.log('Listo. Nada más de la base fue tocado.');

  await p.$disconnect();
})().catch(async (e) => {
  console.error('FALLÓ:', e.message);
  await p.$disconnect();
  process.exit(1);
});
