import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
const cats = await p.category.findMany({
  where: { tenant: { slug: 'nudocowork' }, parentId: null },
  select: { name: true, tagline: true, coverConfig: true, imageUrl: true },
  orderBy: { position: 'asc' },
});
for (const c of cats) {
  const hasCover = c.coverConfig ? '✓' : '✗';
  console.log(`${c.name.padEnd(25)} | cover: ${hasCover} | tagline: ${c.tagline ?? '(null)'}`);
}
await p.$disconnect();
