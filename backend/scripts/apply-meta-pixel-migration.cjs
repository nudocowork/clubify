/**
 * El pixel de Meta por MARCA.
 *
 * Humberto pidio medir las campanas de Sellea (brief del 2026-09-08, pixel
 * 1393034506278228). Se guarda por marca y no fijo en el codigo por dos
 * razones: manana Fideliso pedira el suyo, y —lo importante— un id fijo en el
 * layout se le colaria a TODAS las marcas, que es mandarle el trafico de
 * Clubify a la cuenta publicitaria de Sellea.
 *
 * SQL crudo y aditivo, no `prisma db push`: produccion tiene indices unicos
 * parciales que Prisma no sabe expresar.
 *
 *   railway run node scripts/apply-meta-pixel-migration.cjs
 */
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

(async () => {
  await p.$executeRawUnsafe(
    `ALTER TABLE "WhiteLabel" ADD COLUMN IF NOT EXISTS "metaPixelId" TEXT`,
  );
  console.log('  ok · WhiteLabel.metaPixelId');

  const col = await p.$queryRawUnsafe(
    `SELECT is_nullable FROM information_schema.columns
      WHERE table_name='WhiteLabel' AND column_name='metaPixelId'`,
  );
  if (!col.length) throw new Error('la columna no quedo creada');
  if (col[0].is_nullable !== 'YES') {
    // NULL = esta marca no mide. Una columna NOT NULL con '' obligaria a
    // distinguir vacio de ausente en cada lectura.
    throw new Error('metaPixelId tiene que admitir NULL');
  }

  const marcas = await p.whiteLabel.findMany({ select: { slug: true, metaPixelId: true } });
  console.log(`\nlisto · marcas: ${marcas.length}`);
  for (const m of marcas) console.log(`  ${m.slug}: ${m.metaPixelId ?? '(sin pixel)'}`);
  await p.$disconnect();
})().catch((e) => {
  console.error('ERR', e.message);
  process.exit(1);
});
