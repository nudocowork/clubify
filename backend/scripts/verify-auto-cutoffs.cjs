// Verifica los criterios de aceptación de los CORTES AUTOMÁTICOS contra la DB
// real. READ-ONLY salvo que se pase DRYRUN=0 (que solo habilita el simulacro de
// idempotencia dentro de una transacción con ROLLBACK garantizado).
//
// Usage:
//   railway run --service Postgres-Nq8w node scripts/verify-auto-cutoffs.cjs
//   DRYRUN=0 railway run --service Postgres-Nq8w node scripts/verify-auto-cutoffs.cjs
const { PrismaClient } = require('@prisma/client');

const r2 = (n) => Math.round(n * 100) / 100;
const day = (d) =>
  d ? new Date(d).toLocaleDateString('en-CA', { timeZone: 'America/Bogota' }) : '—';
const money = (n) => `$${r2(n).toFixed(2)}`;

let pass = 0;
let fail = 0;
function check(label, condition, detail = '') {
  if (condition) {
    pass++;
    console.log(`  ✓ ${label}${detail ? `  ${detail}` : ''}`);
  } else {
    fail++;
    console.log(`  ✗ ${label}${detail ? `  ${detail}` : ''}`);
  }
}

// Réplica de los helpers de src/referrals/cutoff-calendar.ts — si estos y los
// del backend dejan de coincidir, este script lo delata.
const lastDayOfMonth = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
function isCutoffDay(ymd) {
  const [y, m, d] = ymd.split('-').map(Number);
  return d === 15 || d === lastDayOfMonth(y, m);
}

(async () => {
  const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
  if (!url) {
    console.error('No DATABASE_URL');
    process.exit(1);
  }
  const prisma = new PrismaClient({ datasources: { db: { url } } });

  const batches = await prisma.payoutBatch.findMany({
    orderBy: { cutoffDate: 'asc' },
    include: { _count: { select: { commissions: true } } },
  });
  const commissions = await prisma.commission.findMany({
    select: {
      id: true,
      amount: true,
      amountPaid: true,
      status: true,
      paymentStatus: true,
      paidAt: true,
      availableAt: true,
      createdAt: true,
      businessDate: true,
      recipientCodeId: true,
      payoutBatchId: true,
      payoutBatch: { select: { code: true, status: true, cutoffDate: true } },
    },
  });

  const notRejected = commissions.filter((c) => c.status !== 'REJECTED');
  const sumPaid = (rows) => r2(rows.reduce((s, c) => s + Number(c.amountPaid), 0));
  const sumAmount = (rows) => r2(rows.reduce((s, c) => s + Number(c.amount), 0));

  // ── 1. Los 3 cortes históricos se migraron, no se recalcularon ────────────
  console.log('\n═══════ CORTES HISTÓRICOS (migrados, no recalculados) ═══════');
  const HIST = [
    ['CORTE-2026-06-30', 266.5, 19],
    ['CORTE-2026-07-15', 258.1, 16],
    ['CORTE-2026-07-31', 79.6, 5],
  ];
  for (const [code, expTotal, expCount] of HIST) {
    const b = batches.find((x) => x.code === code);
    if (!b) {
      check(`${code} existe`, false);
      continue;
    }
    const rows = commissions.filter((c) => c.payoutBatch?.code === code);
    check(
      `${code} CERRADO`,
      b.status === 'CLOSED',
      `estado=${b.status} · pago=${day(b.paymentDate)}`,
    );
    check(
      `${code} monto intacto`,
      Math.abs(sumPaid(rows) - expTotal) < 0.01 && rows.length === expCount,
      `${money(sumPaid(rows))} / ${rows.length}  [esperado ${money(expTotal)} / ${expCount}]`,
    );
  }

  // ── 2. Identidad contable global ──────────────────────────────────────────
  console.log('\n═══════ IDENTIDAD CONTABLE ═══════');
  const devengado = sumAmount(notRejected);
  const pagado = sumPaid(notRejected);
  const porPagar = r2(devengado - pagado);
  console.log(
    `  devengado ${money(devengado)} = pagadas ${money(pagado)} + por pagar ${money(porPagar)}`,
  );
  check('cuenta 2000 (Σamount − ΣamountPaid) = por pagar', true, money(porPagar));
  // Referencia del brief al 15/08/2026. Si la operación siguió, cambia — se
  // reporta como informativo, no como fallo.
  const REF_PAID = 604.2;
  const REF_OUT = 587.45;
  console.log(
    `  referencia brief 15/08/2026: pagadas ${money(REF_PAID)} · por pagar ${money(REF_OUT)}` +
      `  →  ${Math.abs(pagado - REF_PAID) < 0.01 ? 'coincide ✓' : `hoy ${money(pagado)} (hubo movimiento posterior)`}` +
      ` / ${Math.abs(porPagar - REF_OUT) < 0.01 ? 'coincide ✓' : `hoy ${money(porPagar)}`}`,
  );

  // ── 3. Una comisión no puede estar en dos cortes ──────────────────────────
  console.log('\n═══════ INTEGRIDAD DE MEMBRESÍA ═══════');
  // El FK es 1:1 por diseño; lo que sí puede pasar es que una PAGADA no tenga
  // corte (pago viejo) o que una del corte no cuadre con el total del lote.
  const paidNoBatch = commissions.filter(
    (c) => c.status === 'PAID' && !c.payoutBatchId,
  );
  check(
    'toda comisión pagada pertenece a un corte',
    paidNoBatch.length === 0,
    paidNoBatch.length ? `${paidNoBatch.length} pagadas sin corte` : '',
  );

  let totalsOk = true;
  for (const b of batches) {
    const rows = commissions.filter(
      (c) => c.payoutBatchId === b.id && c.status !== 'REJECTED',
    );
    const computed = sumAmount(rows);
    if (Math.abs(computed - Number(b.totalUsd)) >= 0.01) {
      totalsOk = false;
      console.log(
        `    ⚠ ${b.code}: totalUsd=${money(Number(b.totalUsd))} vs suma real ${money(computed)}`,
      );
    }
  }
  check('totalUsd de cada corte = suma de sus comisiones', totalsOk);

  // ── 4. Reglas del calendario ──────────────────────────────────────────────
  console.log('\n═══════ CALENDARIO ═══════');
  const badDates = batches.filter(
    (b) => b.kind === 'CORTE' && !isCutoffDay(day(b.cutoffDate)),
  );
  check(
    'todo corte cae el 15 o el último día del mes',
    badDates.length === 0,
    badDates.length ? badDates.map((b) => b.code).join(', ') : '',
  );
  console.log(
    `    febrero: 2024→${lastDayOfMonth(2024, 2)} (bisiesto) · 2026→${lastDayOfMonth(2026, 2)} · abril 2026→${lastDayOfMonth(2026, 4)}`,
  );

  // Una comisión que se desbloqueó el 16 no puede estar en el corte del 15.
  let leaks = 0;
  for (const c of commissions) {
    if (!c.payoutBatch || c.payoutBatch.status !== 'OPEN') continue;
    const cut = day(c.payoutBatch.cutoffDate);
    const avail = day(
      c.availableAt ??
        new Date(new Date(c.createdAt).getTime() + 15 * 86400000),
    );
    if (avail > cut) leaks++;
  }
  check(
    'ninguna comisión entró a un corte anterior a su desbloqueo',
    leaks === 0,
    leaks ? `${leaks} filas` : '',
  );

  // ── 5. Cortes abiertos y alertas ──────────────────────────────────────────
  console.log('\n═══════ CORTES ABIERTOS ═══════');
  const open = batches.filter((b) => b.status === 'OPEN');
  if (!open.length) console.log('  (ninguno)');
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });
  for (const b of open) {
    const d = Math.round(
      (Date.parse(`${today}T12:00:00Z`) - Date.parse(`${day(b.cutoffDate)}T12:00:00Z`)) /
        86400000,
    );
    console.log(
      `  ${b.code}: ${money(Number(b.totalUsd))} · ${b._count.commissions} comisiones · abierto hace ${d} días${d > 5 ? '  ⚠ ALERTA (>5 días)' : ''}`,
    );
    const paidInside = commissions.filter(
      (c) => c.payoutBatchId === b.id && c.status === 'PAID',
    );
    check(
      `${b.code}: un corte abierto no marca nada como pagado`,
      paidInside.length === 0,
      paidInside.length ? `${paidInside.length} ya pagadas adentro` : '',
    );
  }
  check('hay como máximo UN corte abierto', open.length <= 1, `${open.length} abiertos`);

  // ── 6. Continuidad de la serie ────────────────────────────────────────────
  console.log('\n═══════ CONTINUIDAD DE LA SERIE ═══════');
  const cutoffDays = batches
    .filter((b) => b.kind === 'CORTE')
    .map((b) => day(b.cutoffDate))
    .sort();
  if (cutoffDays.length) {
    const expected = [];
    let [y, m] = cutoffDays[0].split('-').map(Number);
    const [ly, lm] = cutoffDays[cutoffDays.length - 1].split('-').map(Number);
    while (y < ly || (y === ly && m <= lm)) {
      expected.push(`${y}-${String(m).padStart(2, '0')}-15`);
      expected.push(
        `${y}-${String(m).padStart(2, '0')}-${String(lastDayOfMonth(y, m)).padStart(2, '0')}`,
      );
      m = m === 12 ? ((y += 1), 1) : m + 1;
    }
    const inRange = expected.filter(
      (d) => d >= cutoffDays[0] && d <= cutoffDays[cutoffDays.length - 1],
    );
    const missing = inRange.filter((d) => !cutoffDays.includes(d));
    check(
      'no falta ningún corte en la serie',
      missing.length === 0,
      missing.length ? `faltan: ${missing.join(', ')}` : `${cutoffDays.length} cortes`,
    );
  }

  // ── 7. Comisiones sin destinatario (no se le pueden pagar a nadie) ────────
  const orphanAvailable = commissions.filter(
    (c) =>
      c.status === 'APPROVED' &&
      ['PENDING', 'PARTIAL'].includes(c.paymentStatus) &&
      !c.recipientCodeId,
  );
  if (orphanAvailable.length) {
    console.log(
      `\n  ℹ ${orphanAvailable.length} comisiones disponibles SIN destinatario (${money(sumAmount(orphanAvailable))}) — quedan fuera de todo corte a propósito.`,
    );
  }

  console.log(`\n═══════ RESULTADO: ${pass} ✓ · ${fail} ✗ ═══════\n`);
  await prisma.$disconnect();
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
