// READ-ONLY: inspecciona Konys ($5) y las filas pagadas cuyo día-Bogotá de
// businessDate cae en 2026-06-30 o 2026-07-01, con los valores ISO crudos,
// para entender el gap de $5 en el filtro "FECHA DE COMPRA hasta 30/06".
const { PrismaClient } = require('@prisma/client');
const bogota = (d) => d ? new Date(d).toLocaleDateString('en-CA', { timeZone: 'America/Bogota' }) : '—';
const bogTime = (d) => d ? new Date(d).toLocaleString('sv-SE', { timeZone: 'America/Bogota' }) : '—';

(async () => {
  const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  const all = await prisma.commission.findMany({
    select: {
      id: true, amount: true, amountPaid: true, status: true, paidAt: true,
      businessDate: true, createdAt: true, availableAt: true,
      referralUse: { select: { tenant: { select: { brandName: true } } } },
    },
  });

  console.log('\n════ Konys (todas las comisiones) ════');
  all.filter((c) => (c.referralUse?.tenant?.brandName || '').toLowerCase().includes('konys'))
    .forEach((c) => console.log(
      `  $${Number(c.amount)} paid=$${Number(c.amountPaid)} status=${c.status}\n` +
      `    businessDate = ${c.businessDate ? new Date(c.businessDate).toISOString() : 'null'}  (Bogotá ${bogTime(c.businessDate)} → día ${bogota(c.businessDate)})\n` +
      `    createdAt    = ${new Date(c.createdAt).toISOString()}  (día ${bogota(c.createdAt)})\n` +
      `    paidAt       = ${c.paidAt ? new Date(c.paidAt).toISOString() : 'null'}  (día ${bogota(c.paidAt)})`));

  console.log('\n════ PAGADAS con businessDate día-Bogotá ∈ {30/06, 01/07} (crudo) ════');
  all.filter((c) => Number(c.amountPaid) > 0 && ['2026-06-30', '2026-07-01'].includes(bogota(c.businessDate)))
    .sort((a, b) => new Date(a.businessDate) - new Date(b.businessDate))
    .forEach((c) => console.log(
      `  ${(c.referralUse?.tenant?.brandName || '—').padEnd(26)} $${Number(c.amountPaid)}  bd=${new Date(c.businessDate).toISOString()}  Bogotá=${bogTime(c.businessDate)} → ${bogota(c.businessDate)}`));

  console.log('\n════ Distribución de HORA-Bogotá de businessDate (para ver la convención) ════');
  const hours = new Map();
  all.forEach((c) => {
    if (!c.businessDate) return;
    const h = bogTime(c.businessDate).slice(11, 16);
    hours.set(h, (hours.get(h) || 0) + 1);
  });
  [...hours.entries()].sort().forEach(([h, n]) => console.log(`  ${h} → ${n}`));

  await prisma.$disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
