// Setea la Google Maps API key de la marca Sellea (WhiteLabel.mapsApiKey).
// La key se pasa como ARGUMENTO (no se hardcodea en el repo).
// Usage: railway run --service Postgres-Nq8w node /ABS/PATH/backend/scripts/set-sellea-maps-key.cjs <API_KEY>
const { PrismaClient } = require('@prisma/client');

(async () => {
  const key = (process.argv[2] || '').trim();
  if (!key || !key.startsWith('AIza')) {
    console.error('Falta la API key (arg). Uso: node set-sellea-maps-key.cjs AIza...');
    process.exit(1);
  }
  const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
  if (!url) {
    console.error('No DATABASE_URL');
    process.exit(1);
  }
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  const wl = await prisma.whiteLabel.findFirst({ where: { slug: 'sellea' } });
  if (!wl) {
    console.error('No existe la marca sellea.');
    process.exit(1);
  }
  await prisma.whiteLabel.update({
    where: { id: wl.id },
    data: { mapsApiKey: key },
  });
  console.log(`✅ Sellea.mapsApiKey actualizada (${key.slice(0, 10)}…${key.slice(-4)}).`);
  await prisma.$disconnect();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
