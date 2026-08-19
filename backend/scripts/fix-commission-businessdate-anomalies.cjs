// PASO 1 (brief cont.): corrige businessDate CONGELADOS provablemente erróneos.
// Regla: la fecha de compra de una comisión no puede ser POSTERIOR a cuando la
// comisión se creó (createdAt = webhook del cobro). Si businessDate > createdAt
// + 1 día, el valor congelado está mal (el curado 2026-08-14 aplicó la fecha de
// UNA compra a TODAS las comisiones del negocio, envenenando las anteriores —
// ej. Wok $5: bd=05-jul pero created=12-jun y PAGADA el 21-jun, imposible).
// Fix → businessDate = createdAt (la fecha real del cobro de ESA comisión).
//
// Efecto esperado (brief §aceptación, FECHA DE COMPRA, estado Pagadas):
//   hasta 30/06 → $454.30 / 30   ·   hasta 02/07 → $497.10 / 32
//
// DRY-RUN por defecto; --apply para escribir (write-once por fila).
// Usage: railway run --service Postgres-Nq8w node scripts/fix-commission-businessdate-anomalies.cjs [--apply]
const { PrismaClient } = require('@prisma/client');
const DAY = 86400000;
const day = (d) => d ? new Date(d).toLocaleDateString('en-CA', { timeZone: 'America/Bogota' }) : '—';

(async () => {
  const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
  if (!url) { console.error('No DATABASE_URL'); process.exit(1); }
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  const APPLY = process.argv.includes('--apply');

  const all = await prisma.commission.findMany({
    select: {
      id: true, amount: true, amountPaid: true, status: true,
      businessDate: true, createdAt: true, paidAt: true,
      referralUse: { select: { tenant: { select: { brandName: true } } } },
    },
  });

  const bad = all.filter((c) =>
    c.businessDate &&
    new Date(c.businessDate).getTime() > new Date(c.createdAt).getTime() + DAY);

  console.log(`\n== businessDate POSTERIOR a createdAt+1d (provablemente erróneo) ==`);
  if (!bad.length) console.log('  (ninguno ✓)');
  for (const c of bad) {
    console.log(`  ${(c.referralUse?.tenant?.brandName || '—').padEnd(22)} $${Number(c.amount)}  bd=${day(c.businessDate)} → createdAt=${day(c.createdAt)}  (paidAt=${day(c.paidAt)}, status=${c.status})`);
  }

  // Simulación de la aceptación FECHA DE COMPRA sobre PAGADAS, aplicando el fix.
  const fixedBd = (c) => bad.some((b) => b.id === c.id) ? new Date(c.createdAt) : (c.businessDate ? new Date(c.businessDate) : new Date(c.createdAt));
  const paid = all.filter((c) => Number(c.amountPaid) > 0);
  const r2 = (n) => Math.round(n * 100) / 100;
  const upto = (d) => {
    const rows = paid.filter((c) => day(fixedBd(c)) <= d);
    return `$${r2(rows.reduce((s, c) => s + Number(c.amountPaid), 0))} / ${rows.length}`;
  };
  console.log(`\n== Simulación FECHA DE COMPRA (pagadas) tras el fix ==`);
  console.log(`  hasta 30/06 = ${upto('2026-06-30')}   [brief $454.30 / 30]`);
  console.log(`  hasta 02/07 = ${upto('2026-07-02')}   [brief $497.10 / 32]`);

  if (!APPLY) {
    console.log(`\n[DRY-RUN] No se escribió nada. Para aplicar: --apply`);
    await prisma.$disconnect();
    return;
  }
  let written = 0;
  for (const c of bad) {
    const res = await prisma.commission.update({
      where: { id: c.id },
      data: { businessDate: new Date(c.createdAt) },
    });
    if (res) written++;
  }
  console.log(`\n✅ Corregidas ${written} filas (businessDate = createdAt).`);
  await prisma.$disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
