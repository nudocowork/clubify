// READ-ONLY. Actividad reciente de sellos + pases cerca/encima del premio +
// tasa de registro de dispositivo (push) + detalle de la comisión.
const { PrismaClient } = require('@prisma/client');
(async () => {
  const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  const t = await prisma.tenant.findFirst({ where: { slug: { contains: 'valmont', mode: 'insensitive' } }, select: { id: true } });

  // Últimos sellos (¿el escaneo funciona hoy?)
  const last = await prisma.stamp.findMany({
    where: { tenantId: t.id }, orderBy: { createdAt: 'desc' }, take: 10,
    select: { createdAt: true, action: true, orderId: true, customer: { select: { fullName: true } } },
  });
  console.log('Últimos 10 sellos:');
  last.forEach((s) => console.log(`  ${new Date(s.createdAt).toISOString().slice(0, 16).replace('T', ' ')} | ${s.customer?.fullName || '?'} | act=${s.action || '—'} | order=${s.orderId ? 'sí' : 'no'}`));

  // Distribución de sellos por semana (últimas 6)
  const rows = await prisma.$queryRawUnsafe(
    `SELECT date_trunc('week', "createdAt") wk, count(*)::int n FROM "Stamp" WHERE "tenantId"=$1 GROUP BY 1 ORDER BY 1 DESC LIMIT 6`, t.id);
  console.log('\nSellos por semana:');
  rows.forEach((r) => console.log(`  ${new Date(r.wk).toISOString().slice(0, 10)}: ${r.n}`));

  // Pases en/por encima del umbral (premio listo o pasado)
  const card = await prisma.card.findFirst({ where: { tenantId: t.id }, select: { stampsRequired: true } });
  const req = card?.stampsRequired ?? 10;
  const passes = await prisma.pass.findMany({
    where: { tenantId: t.id }, select: { serialNumber: true, stampsCount: true, customer: { select: { fullName: true } } },
    orderBy: { stampsCount: 'desc' }, take: 12,
  });
  console.log(`\nTop pases por sellos (umbral premio=${req}):`);
  passes.forEach((p) => console.log(`  ${p.customer?.fullName || '?'}: ${p.stampsCount}${p.stampsCount >= req ? ' 🎁 premio listo' : ''}`));
  const stuck = await prisma.pass.count({ where: { tenantId: t.id, stampsCount: { gte: req } } });
  console.log(`  Pases con premio disponible (>=${req}): ${stuck}`);

  // Tasa de dispositivo registrado (push)
  const total = await prisma.pass.count({ where: { tenantId: t.id } });
  const withDev = await prisma.pass.count({ where: { tenantId: t.id, walletDevices: { some: {} } } });
  console.log(`\nPush: ${withDev}/${total} pases con dispositivo (${Math.round(100 * withDev / total)}%) → el resto NO recibe notificaciones`);

  // Comisión detalle
  const comm = await prisma.commission.findFirst({
    where: { referralUse: { tenantId: t.id } },
    select: { id: true, amount: true, baseAmountUsd: true, appliedPercent: true, status: true, createdAt: true, availableAt: true },
  });
  console.log(`\nComisión: $${comm.amount} | base=$${comm.baseAmountUsd ?? 'null'} | pct=${comm.appliedPercent ?? 'null'} | ${comm.status} | avail=${comm.availableAt ? new Date(comm.availableAt).toISOString().slice(0,10) : 'null'}`);
  if (comm.baseAmountUsd == null || Number(comm.baseAmountUsd) === 0)
    console.log('  ⚠️ baseAmountUsd 0/null → el arqueo mostrará "10%×$0"; el monto $15 es correcto pero el snapshot está mal.');

  await prisma.$disconnect(); process.exit(0);
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
