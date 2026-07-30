// Diagnóstico: encuentra el/los tenant "Nudo" y muestra slug, status, marca,
// storefront y conteos — para entender por qué /api/public/m/<slug> da 404.
const { PrismaClient } = require('@prisma/client');
(async () => {
  const p = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL } } });
  const rows = await p.tenant.findMany({
    where: {
      OR: [
        { name: { contains: 'nudo', mode: 'insensitive' } },
        { brandName: { contains: 'nudo', mode: 'insensitive' } },
        { slug: { contains: 'nudo', mode: 'insensitive' } },
      ],
    },
    select: {
      id: true, name: true, brandName: true, slug: true, status: true,
      whiteLabelId: true, currentPeriodEnd: true, suspendedAt: true,
      storefront: { select: { id: true, isPublished: true } },
    },
  });
  for (const t of rows) {
    const prods = await p.product.count({ where: { tenantId: t.id } });
    const cats = await p.category.count({ where: { tenantId: t.id } }).catch(() => '?');
    console.log(JSON.stringify({ ...t, products: prods, categories: cats }, null, 2));
  }
  if (!rows.length) console.log('(sin tenants que contengan "nudo")');
  await p.$disconnect();
})().catch((e) => { console.error(e.message); process.exit(1); });
