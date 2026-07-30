// Publica las 2 páginas informativas (isPublished=true). Idempotente.
// Usage: railway run --service Postgres-Nq8w node scripts/publish-info-pages.cjs
const { PrismaClient } = require('@prisma/client');

(async () => {
  const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
  if (!url) { console.error('No DATABASE_URL'); process.exit(1); }
  const prisma = new PrismaClient({ datasources: { db: { url } } });

  const slugs = ['informacion', 'informacion1'];
  const before = await prisma.infoPage.findMany({
    where: { slug: { in: slugs } },
    select: { slug: true, isPublished: true },
  });
  console.log('ANTES:', JSON.stringify(before));

  const res = await prisma.infoPage.updateMany({
    where: { slug: { in: slugs } },
    data: { isPublished: true },
  });
  console.log('Filas actualizadas:', res.count);

  const after = await prisma.infoPage.findMany({
    where: { slug: { in: slugs } },
    select: { slug: true, name: true, title: true, isPublished: true },
  });
  console.log('DESPUÉS:');
  for (const p of after) console.log(`  ${p.isPublished ? '✅' : '⬜'} /${p.slug} — ${p.name} · "${p.title}"`);

  await prisma.$disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
