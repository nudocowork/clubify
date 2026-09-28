/**
 * Migración ADITIVA: agrega `AllyBusiness.zone` y `AllyBusiness.neighborhood`.
 *
 * Al crear un aliado la cuponera pide zona, ciudad y barrio. La ciudad ya
 * existía; zona y barrio no. Son TEXT NOT NULL DEFAULT '' — igual que `city` —
 * así los aliados que ya existen quedan con cadena vacía y nada se rompe.
 *
 * Aditiva e idempotente: `ADD COLUMN IF NOT EXISTS`. Se puede correr varias
 * veces sin efecto. Hay que correrla ANTES de desplegar el backend: Prisma pide
 * las dos columnas en cada consulta a AllyBusiness y sin ellas falla toda la
 * cuponera.
 *
 * Uso:  railway run node scripts/apply-ally-zone-migration.cjs
 */
const { PrismaClient } = require('@prisma/client');
// Pública primero: la interna (`…railway.internal`) solo resuelve dentro de
// Railway y desde un portátil el script moriría.
const p = new PrismaClient({
  datasources: {
    db: { url: process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL },
  },
});

(async () => {
  for (const col of ['zone', 'neighborhood']) {
    console.log(`Agregando AllyBusiness."${col}" (TEXT NOT NULL DEFAULT '')…`);
    await p.$executeRawUnsafe(
      `ALTER TABLE "AllyBusiness" ADD COLUMN IF NOT EXISTS "${col}" TEXT NOT NULL DEFAULT ''`,
    );
  }

  const cols = await p.$queryRawUnsafe(`
    SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns
    WHERE table_name = 'AllyBusiness' AND column_name IN ('zone', 'neighborhood')
    ORDER BY column_name
  `);
  console.log('Resultado:', cols);
  if (cols.length !== 2) throw new Error('No quedaron las dos columnas');

  const [{ n }] = await p.$queryRawUnsafe(`SELECT COUNT(*)::int AS n FROM "AllyBusiness"`);
  console.log(`Aliados existentes: ${n} (todos con zona y barrio vacíos).`);
  await p.$disconnect();
})().catch(async (e) => {
  console.error('ERROR:', e.message);
  await p.$disconnect();
  process.exit(1);
});
