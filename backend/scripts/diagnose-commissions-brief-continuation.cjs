// READ-ONLY diagnóstico para la CONTINUACIÓN del brief de comisiones.
// Reconstruye TODOS los números objetivo del brief desde el estado actual de
// la DB, para verificar los supuestos ANTES de escribir nada.
// Usage: railway run --service Postgres-Nq8w node scripts/diagnose-commissions-brief-continuation.cjs
const { PrismaClient } = require('@prisma/client');

const r2 = (n) => Math.round(n * 100) / 100;
const bogota = (d) =>
  d ? new Date(d).toLocaleDateString('en-CA', { timeZone: 'America/Bogota' }) : '—';

(async () => {
  const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
  if (!url) { console.error('No DATABASE_URL'); process.exit(1); }
  const prisma = new PrismaClient({ datasources: { db: { url } } });

  const all = await prisma.commission.findMany({
    select: {
      id: true, amount: true, amountPaid: true, status: true, paymentStatus: true,
      paidAt: true, businessDate: true, availableAt: true, createdAt: true,
      businessGroupId: true, referralUseId: true,
      referralUse: { select: { tenant: { select: { id: true, brandName: true } } } },
      recipientCode: { select: { code: true, ownerName: true } },
    },
  });

  const sum = (rows, f = (c) => Number(c.amount)) => r2(rows.reduce((s, c) => s + f(c), 0));
  const notRej = all.filter((c) => c.status !== 'REJECTED');
  const rej = all.filter((c) => c.status === 'REJECTED');
  const paid = all.filter((c) => Number(c.amountPaid) > 0);
  const statusPaid = all.filter((c) => c.status === 'PAID');
  const pmtPaid = all.filter((c) => c.paymentStatus === 'PAID');

  console.log('\n════════ KPIs GLOBALES (estado actual) ════════');
  console.log(`Devengado total (status != REJECTED): $${sum(notRej)}  ·  ${notRej.length} comisiones   [brief: $1,191.65 / 75]`);
  console.log(`Anuladas (REJECTED):                  $${sum(rej)}  ·  ${rej.length} comisiones   [brief: $260.50 / 17]`);
  console.log(`Pagadas (amountPaid>0):               $${sum(paid, (c) => Number(c.amountPaid))}  ·  ${paid.length} comisiones   [brief PASO4-after: $604.20 / 40]`);
  console.log(`  · status=PAID:                       $${sum(statusPaid, (c) => Number(c.amountPaid))}  ·  ${statusPaid.length}`);
  console.log(`  · paymentStatus=PAID:                $${sum(pmtPaid, (c) => Number(c.amountPaid))}  ·  ${pmtPaid.length}`);
  console.log(`Pendiente (Devengado − Pagado):       $${r2(sum(notRej) - sum(paid, (c) => Number(c.amountPaid)))}   [brief PASO4-after: $587.45 / 35]`);

  console.log('\n════════ PAGADAS agrupadas por paidAt (día Bogotá) ════════');
  const byPaid = new Map();
  for (const c of paid) {
    const k = bogota(c.paidAt);
    const cur = byPaid.get(k) ?? { n: 0, amt: 0 };
    cur.n++; cur.amt = r2(cur.amt + Number(c.amountPaid));
    byPaid.set(k, cur);
  }
  [...byPaid.entries()].sort().forEach(([k, v]) => console.log(`  ${k}:  $${v.amt}  ·  ${v.n} filas`));
  console.log(`  (brief lotes → 30/06:$266.50/19 · 15/07:$258.10/16 · 31/07:$79.60/5)`);

  console.log('\n════════ PAGADAS "hasta X" por FECHA DE PAGO (día Bogotá, inclusivo) ════════');
  const paidUpto = (day) => {
    const rows = paid.filter((c) => bogota(c.paidAt) <= day);
    return `$${sum(rows, (c) => Number(c.amountPaid))} · ${rows.length} filas`;
  };
  console.log(`  hasta 2026-06-30: ${paidUpto('2026-06-30')}   [brief: $266.50 / 19]`);
  console.log(`  hasta 2026-07-15: ${paidUpto('2026-07-15')}   [brief: $524.60 / 35]`);
  console.log(`  hasta 2026-07-31: ${paidUpto('2026-07-31')}   [brief: $604.20 / 40]`);

  console.log('\n════════ PAGADAS "hasta X" por FECHA DE COMPRA (businessDate, día Bogotá) ════════');
  const bcUpto = (day) => {
    const rows = paid.filter((c) => bogota(c.businessDate ?? c.createdAt) <= day);
    return `$${sum(rows, (c) => Number(c.amountPaid))} · ${rows.length} filas`;
  };
  console.log(`  hasta 2026-06-30: ${bcUpto('2026-06-30')}   [brief: $454.30 / 30]`);
  console.log(`  hasta 2026-07-02: ${bcUpto('2026-07-02')}   [brief: $497.10 / 32]`);

  console.log('\n════════ 5 comisiones del CORTE-2026-07-31 (Nicolas Quintero TAFMPWK5) ════════');
  const brief31 = ['ALTIERI', 'Extreme House', 'BIEN MARACUCHO', 'Essentrix', 'Top Man'];
  for (const name of brief31) {
    const rows = all.filter((c) =>
      (c.referralUse?.tenant?.brandName || '').toLowerCase().includes(name.toLowerCase()));
    for (const c of rows) {
      console.log(`  ${(c.referralUse?.tenant?.brandName || '—').padEnd(28)} $${Number(c.amount)}  status=${c.status}  pmt=${c.paymentStatus}  paid=$${Number(c.amountPaid)}  recip=${c.recipientCode?.code}  compra(bd)=${bogota(c.businessDate)}  avail=${bogota(c.availableAt)}`);
    }
  }

  console.log('\n════════ D\'Ponke (NO tocar, $50 pendiente legítimo) ════════');
  all.filter((c) => (c.referralUse?.tenant?.brandName || '').toLowerCase().includes('ponke'))
    .forEach((c) => console.log(`  ${c.referralUse?.tenant?.brandName}  $${Number(c.amount)}  status=${c.status}  pmt=${c.paymentStatus}  paid=$${Number(c.amountPaid)}`));

  console.log('\n════════ Comisiones SIN businessId (grupo empresarial / referralUseId null) ════════');
  const noBiz = all.filter((c) => !c.referralUse?.tenant?.id);
  noBiz.forEach((c) => console.log(`  amount=$${Number(c.amount)}  status=${c.status}  paid=$${Number(c.amountPaid)}  group=${c.businessGroupId ?? '—'}  recip=${c.recipientCode?.code}(${c.recipientCode?.ownerName ?? '—'})`));
  console.log(`  → total sin businessId: $${sum(noBiz)} · pagado $${sum(noBiz, (c) => Number(c.amountPaid))}`);

  console.log('\n════════ 7 casos de aceptación PASO 1 (businessDate = fecha compra) ════════');
  const ACC = [['LICORES', '2026-07-16'], ['Wok', '2026-07-05'], ['SUGAR', '2026-07-02'],
    ['MOTILART', '2026-06-22'], ['Macondo', '2026-06-21'], ['Essentrix', '2026-07-28'], ['Top Man', '2026-07-28']];
  for (const [name, expect] of ACC) {
    const rows = notRej.filter((c) => (c.referralUse?.tenant?.brandName || '').toLowerCase().includes(name.toLowerCase()));
    const days = [...new Set(rows.map((c) => bogota(c.businessDate ?? c.createdAt)))];
    console.log(`  ${days.join(', ').padEnd(24)} (esperado ${expect}) ${days.length === 1 && days[0] === expect ? '✓' : '⚠'}  ${name}`);
  }

  console.log('\n════════ HISTÓRICO PAGADO por persona (recipientCode) ════════');
  const byPerson = new Map();
  for (const c of paid) {
    const k = c.recipientCode?.code ?? '—';
    const cur = byPerson.get(k) ?? { name: c.recipientCode?.ownerName ?? '—', amt: 0, n: 0 };
    cur.amt = r2(cur.amt + Number(c.amountPaid)); cur.n++;
    byPerson.set(k, cur);
  }
  [...byPerson.entries()].sort((a, b) => b[1].amt - a[1].amt)
    .forEach(([code, v]) => console.log(`  ${code} (${v.name}): $${v.amt} · ${v.n}`));
  console.log(`  → SUMA histórico pagado (todos): $${sum(paid, (c) => Number(c.amountPaid))}  [brief: $604.20]`);

  await prisma.$disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
