// SOLO LECTURA. Revisa el estado de bloqueo/estatus de los negocios de Sellea.
// Si isLocked=true → TenantLockGuard rechaza toda escritura (423) → "guardo y no
// pasa nada" en infolinks y en todo el panel.
//   railway run --service Postgres-Nq8w node scripts/inspect-sellea-tenants-lock.cjs
const { PrismaClient } = require('@prisma/client');
(async () => {
  const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
  if (!url) { console.error('No DATABASE_URL'); process.exit(1); }
  const prisma = new PrismaClient({ datasources: { db: { url } } });

  const wl = await prisma.whiteLabel.findFirst({
    where: { slug: 'sellea' }, select: { id: true, name: true },
  });
  if (!wl) { console.log('Sellea no encontrada'); await prisma.$disconnect(); return; }

  const tenants = await prisma.tenant.findMany({
    where: { whiteLabelId: wl.id },
    select: {
      id: true, name: true, slug: true, status: true,
      isLocked: true, lockedAt: true, lockedReason: true,
    },
  });

  console.log(`Negocios de ${wl.name}: ${tenants.length}\n`);
  for (const t of tenants) {
    console.log(`- ${t.name} (/${t.slug})`);
    console.log(`    status=${t.status}  isLocked=${t.isLocked}  lockedReason=${t.lockedReason ?? '-'}`);
  }
  await prisma.$disconnect();
})().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
