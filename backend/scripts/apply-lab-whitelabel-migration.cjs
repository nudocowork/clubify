/**
 * Migración ADITIVA: `LabProposal.whiteLabelId` — el Lab de cada marca es SUYO.
 *
 * El feed era global: un afiliado de Sellea veía las propuestas de la
 * comunidad de Clubify, con el nombre de Sellea encima. No era solo una fuga
 * de marca, era una fuga de contenido.
 *
 * Además del ALTER, hace el **backfill**: cada propuesta hereda la marca de su
 * autor (por su ReferralCode, que es donde vive la marca de un afiliado; o por
 * `User.whiteLabelId` si es admin de marca). Las que no resuelvan quedan en
 * null y se tratan como de la plataforma — históricas, son 3.
 *
 * Aditiva e idempotente. NUNCA usar `prisma db push` contra producción.
 *
 * Uso:
 *   railway run node scripts/apply-lab-whitelabel-migration.cjs
 *   railway run node scripts/apply-lab-whitelabel-migration.cjs --aplicar
 */
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
const APLICAR = process.argv.includes('--aplicar');

(async () => {
  const [{ n }] = await p.$queryRawUnsafe(`
    SELECT COUNT(*)::int AS n FROM information_schema.columns
     WHERE table_name = 'LabProposal' AND column_name = 'whiteLabelId'`);

  if (!n) {
    if (!APLICAR) {
      console.log('Falta la columna "whiteLabelId" en LabProposal.');
      console.log('(en seco — volvé a correrlo con --aplicar)');
      return p.$disconnect();
    }
    console.log('Agregando LabProposal."whiteLabelId" (TEXT, nullable)…');
    await p.$executeRawUnsafe(
      `ALTER TABLE "LabProposal" ADD COLUMN IF NOT EXISTS "whiteLabelId" TEXT`,
    );
    await p.$executeRawUnsafe(
      `CREATE INDEX IF NOT EXISTS "LabProposal_whiteLabelId_idx" ON "LabProposal"("whiteLabelId")`,
    );
    console.log('  columna + índice listos.');
  } else {
    console.log('La columna ya existe.');
  }

  // Backfill: la marca del autor. Primero por su código de afiliado (donde
  // vive la marca de un afiliado), si no por su marca de administrador.
  const pendientes = await p.$queryRawUnsafe(`
    SELECT lp.id, lp.title,
           COALESCE(rc."whiteLabelId", u."whiteLabelId") AS wl,
           COALESCE(w.slug, wu.slug) AS marca
      FROM "LabProposal" lp
      JOIN "User" u ON u.id = lp."authorId"
      LEFT JOIN "ReferralCode" rc ON rc."ownerUserId" = u.id
      LEFT JOIN "WhiteLabel" w  ON w.id  = rc."whiteLabelId"
      LEFT JOIN "WhiteLabel" wu ON wu.id = u."whiteLabelId"
     WHERE lp."whiteLabelId" IS NULL`);

  const conMarca = pendientes.filter((x) => x.wl);
  console.log(`\nPropuestas sin marca: ${pendientes.length}`);
  console.log(`  deducibles del autor: ${conMarca.length}`);
  for (const x of conMarca) {
    console.log(`    "${String(x.title).slice(0, 40)}" → ${x.marca}`);
  }
  console.log(
    `  sin autor con marca: ${pendientes.length - conMarca.length} (quedan null = de la plataforma)`,
  );

  if (!APLICAR) {
    console.log('\n(en seco — volvé a correrlo con --aplicar)');
    return p.$disconnect();
  }

  let k = 0;
  for (const x of conMarca) {
    await p.$executeRawUnsafe(
      `UPDATE "LabProposal" SET "whiteLabelId" = $1 WHERE id = $2`,
      x.wl,
      x.id,
    );
    k++;
  }
  console.log(`\n✅ ${k} propuesta(s) marcadas. Nada más fue tocado.`);

  await p.$disconnect();
})().catch(async (e) => {
  console.error('FALLÓ:', e.message);
  await p.$disconnect();
  process.exit(1);
});
