// Criterios de aceptación del brief (continuación), replicando EXACTO la lógica
// del backend ya desplegado (boundary Bogotá inclusivo, campo según tipo de
// fecha). Read-only. Marca [PASO4] los que solo cierran tras registrar el corte.
// Usage: railway run --service Postgres-Nq8w node scripts/acceptance-criteria.cjs
const { PrismaClient } = require('@prisma/client');
const r2 = (n) => Math.round(n * 100) / 100;
const day = (d) => d ? new Date(d).toLocaleDateString('en-CA', { timeZone: 'America/Bogota' }) : '—';
const ok = (a, b) => Math.abs(a - b) < 0.01 ? '✓' : '✗';

(async () => {
  const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  const all = await prisma.commission.findMany({
    select: {
      amount: true, amountPaid: true, status: true, paidAt: true, businessDate: true,
      payoutBatch: { select: { code: true } },
    },
  });
  const notRej = all.filter((c) => c.status !== 'REJECTED');
  const paidRows = all.filter((c) => c.status === 'PAID');
  const sumP = (rows) => r2(rows.reduce((s, c) => s + Number(c.amountPaid), 0));
  const sumA = (rows) => r2(rows.reduce((s, c) => s + Number(c.amount), 0));

  console.log('\n═══════ FILTRO POR FECHA DE PAGO · estado Pagadas ═══════');
  for (const [d, ea, ec] of [['2026-06-30', 266.5, 19], ['2026-07-15', 524.6, 35], ['2026-07-31', 604.2, 40]]) {
    const rows = paidRows.filter((c) => day(c.paidAt) <= d);
    const a = sumP(rows);
    console.log(`  hasta ${d}: $${a} / ${rows.length}   [brief $${ea} / ${ec}]  ${ok(a, ea)}${rows.length === ec ? '' : ' (count✗)'}${d === '2026-07-31' ? '  [PASO4]' : ''}`);
  }

  console.log('\n═══════ FILTRO POR LOTE ═══════');
  for (const [code, ea, ec] of [['CORTE-2026-06-30', 266.5, 19], ['CORTE-2026-07-15', 258.1, 16], ['CORTE-2026-07-31', 79.6, 5]]) {
    const rows = all.filter((c) => c.payoutBatch?.code === code);
    const a = sumP(rows);
    console.log(`  ${code}: $${a} / ${rows.length}   [brief $${ea} / ${ec}]  ${ok(a, ea)}${rows.length === ec ? '' : ' (count)'}${code.endsWith('31') ? '  [PASO4]' : ''}`);
  }

  console.log('\n═══════ FILTRO POR FECHA DE COMPRA · estado Pagadas ═══════');
  for (const [d, ea, ec] of [['2026-06-30', 454.3, 30], ['2026-07-02', 497.1, 32]]) {
    const rows = paidRows.filter((c) => day(c.businessDate) <= d);
    const a = sumP(rows);
    console.log(`  hasta ${d}: $${a} / ${rows.length}   [brief $${ea} / ${ec}]  ${ok(a, ea)}${rows.length === ec ? '' : ' (count)'}`);
  }

  console.log('\n═══════ KPIs ═══════');
  const devengado = sumA(notRej);
  const pagadas = sumP(paidRows);
  const pendiente = r2(devengado - pagadas);
  const anuladas = sumA(all.filter((c) => c.status === 'REJECTED'));
  const saldo2000 = r2(sumA(notRej) - sumP(notRej));
  console.log(`  Devengado total:      $${devengado} / ${notRej.length}   [brief $1191.65 / 75]  ${ok(devengado, 1191.65)}`);
  console.log(`  Pagadas:              $${pagadas} / ${paidRows.length}   [brief $604.20 / 40]  ${ok(pagadas, 604.2)}  [PASO4]`);
  console.log(`  Pendiente por pagar:  $${pendiente} / ${notRej.length - paidRows.length}   [brief $587.45 / 35]  ${ok(pendiente, 587.45)}  [PASO4]`);
  console.log(`  Anuladas:             $${anuladas} / ${all.filter((c) => c.status === 'REJECTED').length}   [brief $260.50 / 17]  ${ok(anuladas, 260.5)}`);
  console.log(`  Histórico pagado:     $${pagadas}   [brief $604.20]  ${ok(pagadas, 604.2)}  [PASO4]`);
  console.log(`  Cuenta 2000 (libro):  $${saldo2000}   [brief $587.45]  ${ok(saldo2000, 587.45)}  [PASO4]`);
  console.log(`  Identidad devengado = pagadas + pendiente: $${devengado} = $${r2(pagadas + pendiente)}  ${ok(devengado, r2(pagadas + pendiente))}`);

  console.log('\n(Los [PASO4] cierran en su valor objetivo al registrar el corte del 31/07.)');
  await prisma.$disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
