import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
const all = await p.tenant.findMany({
  where: { OR: [{ slug: { contains: 'nudo', mode: 'insensitive' } }, { brandName: { contains: 'nudo', mode: 'insensitive' } }] },
  select: { id: true, slug: true, brandName: true, status: true },
});
console.log(JSON.stringify(all, null, 2));
await p.$disconnect();
