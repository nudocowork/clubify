// READ-ONLY. Capacidad real de refresh/push por plataforma + fechas de
// instalación (correlación con la era JWT-largo jun16-17 = barcode ilegible).
const { PrismaClient } = require('@prisma/client');
(async () => {
  const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  const t = await prisma.tenant.findFirst({ where: { slug: { contains: 'valmont', mode: 'insensitive' } }, select: { id: true } });

  const passes = await prisma.pass.findMany({
    where: { tenantId: t.id },
    select: { id: true, serialNumber: true, qrToken: true, status: true,
      walletPlatform: true, walletInstalledAt: true, googleObjectId: true,
      issuedAt: true, lastActivityAt: true,
      _count: { select: { walletDevices: true } } },
    orderBy: { issuedAt: 'asc' },
  });

  const stat = {
    APPLE: { total: 0, refreshable: 0, noDevice: 0 },
    GOOGLE: { total: 0, refreshable: 0, noObjId: 0 },
    NONE: 0,
  };
  const installByWeek = {};
  for (const p of passes) {
    const plat = p.walletPlatform;
    if (plat === 'APPLE') {
      stat.APPLE.total++;
      if (p._count.walletDevices > 0) stat.APPLE.refreshable++; else stat.APPLE.noDevice++;
    } else if (plat === 'GOOGLE') {
      stat.GOOGLE.total++;
      if (p.googleObjectId) stat.GOOGLE.refreshable++; else stat.GOOGLE.noObjId++;
    } else {
      stat.NONE++;
    }
    const inst = p.walletInstalledAt || p.issuedAt;
    if (inst) {
      const wk = new Date(inst).toISOString().slice(0, 10);
      const monday = new Date(inst); monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
      const key = monday.toISOString().slice(0, 10);
      installByWeek[key] = (installByWeek[key] || 0) + 1;
    }
  }

  console.log('CAPACIDAD DE REFRESH/PUSH por plataforma:');
  console.log(`  APPLE:  ${stat.APPLE.total} pases | refrescables ${stat.APPLE.refreshable} | SIN dispositivo ${stat.APPLE.noDevice} ⚠️ (no push, barcode congelado)`);
  console.log(`  GOOGLE: ${stat.GOOGLE.total} pases | refrescables ${stat.GOOGLE.refreshable} | SIN googleObjectId ${stat.GOOGLE.noObjId} ⚠️`);
  console.log(`  Sin instalar: ${stat.NONE}`);

  console.log('\nInstalaciones por semana (⚠️ semana del 2026-06-15 = era JWT-largo, barcode pudo quedar ilegible):');
  Object.entries(installByWeek).sort().forEach(([w, n]) => console.log(`  ${w}: ${n}`));

  // Pases APPLE sin device (los que NO se pueden arreglar por push → hay que
  // pedirle al cliente reinstalar, o el staff teclea el código CLB-…)
  const appleNoDev = passes.filter((p) => p.walletPlatform === 'APPLE' && p._count.walletDevices === 0);
  console.log(`\nApple sin dispositivo (${appleNoDev.length}) — muestra:`);
  appleNoDev.slice(0, 8).forEach((p) => console.log(`  ${p.serialNumber} | inst ${p.walletInstalledAt ? new Date(p.walletInstalledAt).toISOString().slice(0,10) : '—'} | tok ${p.qrToken?.slice(0,10)}`));

  await prisma.$disconnect(); process.exit(0);
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
