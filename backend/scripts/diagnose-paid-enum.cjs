// READ-ONLY: enumera las 35 comisiones PAGADAS con sus fechas (día Bogotá) para
// identificar exactamente qué fila explica el gap de $5 en "FECHA DE COMPRA
// hasta 30/06" ($449.30/29 vs brief $454.30/30).
const { PrismaClient } = require('@prisma/client');
const day = (d) => d ? new Date(d).toLocaleDateString('en-CA', { timeZone: 'America/Bogota' }) : '—';

(async () => {
  const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  const paid = (await prisma.commission.findMany({
    where: { amountPaid: { gt: 0 } },
    select: {
      id: true, amountPaid: true, businessDate: true, createdAt: true, paidAt: true,
      referralUse: { select: { tenant: { select: { brandName: true } } } },
    },
  })).sort((a, b) => new Date(a.businessDate ?? a.createdAt) - new Date(b.businessDate ?? b.createdAt));

  const r2 = (n) => Math.round(n * 100) / 100;
  let cum = 0;
  console.log('#   COMPRA(bd)   CREATED     PAGO        $        acum      NEGOCIO');
  paid.forEach((c, i) => {
    cum = r2(cum + Number(c.amountPaid));
    const bd = day(c.businessDate ?? c.createdAt);
    const flag = bd <= '2026-06-30' ? ' ≤30/06' : bd <= '2026-07-02' ? ' ≤02/07' : '';
    console.log(
      `${String(i + 1).padStart(2)}  ${bd}   ${day(c.createdAt)}  ${day(c.paidAt).padEnd(10)}  $${String(Number(c.amountPaid)).padStart(6)}  $${String(cum).padStart(7)}  ${(c.referralUse?.tenant?.brandName || '— (sin businessId)')}${flag}`);
  });

  const upto = (d, field) => {
    const rows = paid.filter((c) => day(field === 'bd' ? (c.businessDate ?? c.createdAt) : c[field]) <= d);
    return `$${r2(rows.reduce((s, c) => s + Number(c.amountPaid), 0))} / ${rows.length}`;
  };
  console.log('\nFECHA DE COMPRA (businessDate):');
  console.log(`  hasta 30/06 = ${upto('2026-06-30', 'bd')}   [brief $454.30/30]`);
  console.log(`  hasta 02/07 = ${upto('2026-07-02', 'bd')}   [brief $497.10/32]`);
  console.log('FECHA DE COMPRA usando createdAt en vez de businessDate:');
  const uptoCreated = (d) => {
    const rows = paid.filter((c) => day(c.createdAt) <= d);
    return `$${r2(rows.reduce((s, c) => s + Number(c.amountPaid), 0))} / ${rows.length}`;
  };
  console.log(`  hasta 30/06 = ${uptoCreated('2026-06-30')}`);
  console.log(`  hasta 02/07 = ${uptoCreated('2026-07-02')}`);

  await prisma.$disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
