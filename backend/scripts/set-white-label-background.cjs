// Setea el color de fondo del sidebar del panel de una marca blanca
// (WhiteLabel.backgroundColor). El panel usa ese tono para el sidebar en vez de
// derivarlo del color de acento. PDF Fidelity 2026-07-29.
//   SLUG=sellea COLOR=#1A1033 \
//     railway run --service Postgres-Nq8w node scripts/set-white-label-background.cjs
const { PrismaClient } = require('@prisma/client');
(async () => {
  const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
  if (!url) { console.error('No DATABASE_URL'); process.exit(1); }
  const slug = (process.env.SLUG || '').trim().toLowerCase();
  const color = (process.env.COLOR || '').trim();
  if (!slug) { console.error('Falta SLUG'); process.exit(1); }
  if (color && !/^#[0-9a-fA-F]{6}$/.test(color)) {
    console.error(`COLOR inválido: "${color}" (esperado #RRGGBB o vacío para limpiar)`);
    process.exit(1);
  }
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  const wl = await prisma.whiteLabel.findFirst({
    where: { slug },
    select: { id: true, name: true, backgroundColor: true, primaryColor: true },
  });
  if (!wl) { console.error(`No existe marca slug="${slug}"`); process.exit(1); }
  console.log(`Antes: ${wl.name} backgroundColor=${wl.backgroundColor ?? '(null → derivado del acento ' + wl.primaryColor + ')'}`);
  const updated = await prisma.whiteLabel.update({
    where: { id: wl.id },
    data: { backgroundColor: color || null },
    select: { backgroundColor: true },
  });
  console.log(`✅ ${wl.name} → backgroundColor = ${updated.backgroundColor ?? '(null)'}`);
  await prisma.$disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
