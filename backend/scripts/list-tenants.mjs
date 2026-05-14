import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
const tenants = await prisma.tenant.findMany({ select: { id: true, slug: true, brandName: true } });
for (const t of tenants) console.log(`${t.slug.padEnd(30)} ${t.brandName} (${t.id})`);
await prisma.$disconnect();
