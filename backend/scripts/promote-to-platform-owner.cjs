// Promueve el primer PLATFORM_OWNER. Lee email del argv.
// Usage: railway run --service Postgres-Nq8w node scripts/promote-to-platform-owner.cjs jhonarias888@gmail.com
const { PrismaClient } = require('@prisma/client');

(async () => {
  const email = (process.argv[2] || '').trim().toLowerCase();
  if (!email) { console.error('Email requerido como argumento'); process.exit(1); }
  const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
  const prisma = new PrismaClient({ datasources: { db: { url } } });

  const u = await prisma.user.findFirst({
    where: { email: { equals: email, mode: 'insensitive' } },
  });
  if (!u) { console.error(`User no encontrado: ${email}`); process.exit(1); }

  await prisma.user.update({
    where: { id: u.id },
    data: { role: 'PLATFORM_OWNER', tenantId: null },
  });
  console.log(`✓ ${u.email} promovido a PLATFORM_OWNER (tenantId limpiado)`);

  await prisma.$disconnect();
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
