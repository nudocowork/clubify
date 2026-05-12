#!/usr/bin/env node
// Lista tenants con storefront publicado para auditar visualmente.
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
try {
  const tenants = await prisma.tenant.findMany({
    where: { storefront: { isNot: null } },
    select: {
      slug: true,
      brandName: true,
      primaryColor: true,
      secondaryColor: true,
      logoUrl: true,
      createdAt: true,
      storefront: { select: { isPublished: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: 20,
  });
  console.log(`Encontrados ${tenants.length} tenants con storefront:`);
  for (const t of tenants) {
    const colors = t.primaryColor || t.secondaryColor
      ? `${t.primaryColor || '-'} → ${t.secondaryColor || '-'}`
      : '(default Clubify)';
    const logo = t.logoUrl ? '✓' : '∅';
    const pub = t.storefront?.isPublished ? 'pub' : 'draft';
    console.log(`  /m/${t.slug.padEnd(28)} ${t.brandName.slice(0, 20).padEnd(22)} ${pub} logo=${logo} colors=${colors}`);
  }
} catch (e) {
  console.error('✗', e.message);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
