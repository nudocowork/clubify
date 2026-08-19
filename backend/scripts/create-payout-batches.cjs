// PASO 3 (brief cont.): crea los 3 lotes de corte históricos y asigna las 35
// comisiones ya pagadas a su lote, REESCRIBIENDO paidAt = fecha real del corte
// (los stamps viejos 21-jun/02-jul/28-jul no correspondían a ninguna
// transferencia). Respalda el paidAt anterior en paidAtLegacy (write-once).
//
// Partición (verificada en prod por diagnóstico):
//   paidAt-day ∈ {2026-06-21, 2026-07-02} → CORTE-2026-06-30  (19 filas, $266.50)
//   paidAt-day == 2026-07-28              → CORTE-2026-07-15  (16 filas, $258.10)
//   CORTE-2026-07-31 se crea VACÍO aquí; se puebla en PASO 4 (gated).
//
// Idempotente: solo asigna filas con payoutBatchId=null. Aborta --apply si la
// partición no cuadra con el brief.
// Usage: railway run --service Postgres-Nq8w node scripts/create-payout-batches.cjs [--apply]
const { PrismaClient } = require('@prisma/client');
const r2 = (n) => Math.round(n * 100) / 100;
const day = (d) => d ? new Date(d).toLocaleDateString('en-CA', { timeZone: 'America/Bogota' }) : '—';
const at12Bogota = (ymd) => new Date(`${ymd}T17:00:00.000Z`); // 12:00 Bogotá

const BATCHES = [
  { code: 'CORTE-2026-06-30', cutoff: '2026-06-30', payment: '2026-06-30' },
  { code: 'CORTE-2026-07-15', cutoff: '2026-07-15', payment: '2026-07-15' },
  { code: 'CORTE-2026-07-31', cutoff: '2026-07-31', payment: '2026-07-31' },
];
const EXPECT = {
  'CORTE-2026-06-30': { count: 19, total: 266.5 },
  'CORTE-2026-07-15': { count: 16, total: 258.1 },
};
const batchForPaidDay = (d) => {
  if (d === '2026-06-21' || d === '2026-07-02') return 'CORTE-2026-06-30';
  if (d === '2026-07-28') return 'CORTE-2026-07-15';
  return null; // inesperado
};

(async () => {
  const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
  if (!url) { console.error('No DATABASE_URL'); process.exit(1); }
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  const APPLY = process.argv.includes('--apply');

  // Select MÍNIMO (columnas que existen aun antes de la migración) para que el
  // dry-run corra sin payoutBatchId. La escritura es write-once vía updateMany
  // con guard `payoutBatchId: null`.
  const paid = await prisma.commission.findMany({
    where: { amountPaid: { gt: 0 } },
    select: {
      id: true, amountPaid: true, paidAt: true,
      referralUse: { select: { tenant: { select: { brandName: true } } } },
    },
  });

  // Partición.
  const groups = new Map(); // code -> {rows[], total}
  let unexpected = 0;
  for (const c of paid) {
    const code = batchForPaidDay(day(c.paidAt));
    if (!code) {
      unexpected++;
      console.log(`  ⚠ INESPERADO: ${c.referralUse?.tenant?.brandName || '—'} paidAt=${day(c.paidAt)} $${Number(c.amountPaid)}`);
      continue;
    }
    const g = groups.get(code) ?? { rows: [], total: 0 };
    g.rows.push(c); g.total = r2(g.total + Number(c.amountPaid));
    groups.set(code, g);
  }

  console.log(`\n== Partición de las ${paid.length} comisiones pagadas ==`);
  let mismatch = 0;
  for (const [code, exp] of Object.entries(EXPECT)) {
    const g = groups.get(code) ?? { rows: [], total: 0 };
    const ok = g.rows.length === exp.count && Math.abs(g.total - exp.total) < 0.01;
    if (!ok) mismatch++;
    console.log(`  ${ok ? '✓' : '✗'} ${code}: ${g.rows.length} filas · $${g.total}   [brief ${exp.count} · $${exp.total}]`);
  }
  if (unexpected) console.log(`  ✗ ${unexpected} filas con paidAt fuera de {21-jun,02-jul,28-jul}`);

  if (!APPLY) {
    console.log(`\n[DRY-RUN] No se escribió nada. ${mismatch || unexpected ? '⚠ HAY DESAJUSTES — revisar antes de aplicar.' : 'Partición OK.'}`);
    console.log(`Para aplicar: --apply`);
    await prisma.$disconnect();
    return;
  }
  if (mismatch || unexpected) {
    console.error(`\n❌ ABORTADO: la partición no cuadra con el brief. No se escribió nada.`);
    await prisma.$disconnect();
    process.exit(1);
  }

  // Crear/actualizar los 3 lotes (upsert por code, idempotente).
  const batchByCode = new Map();
  for (const b of BATCHES) {
    const rec = await prisma.payoutBatch.upsert({
      where: { code: b.code },
      update: {},
      create: {
        code: b.code,
        cutoffDate: at12Bogota(b.cutoff),
        paymentDate: at12Bogota(b.payment),
        kind: 'CORTE',
      },
    });
    batchByCode.set(b.code, rec);
  }
  console.log(`\n✅ Lotes creados/existentes: ${BATCHES.map((b) => b.code).join(', ')}`);

  // Asignar + reescribir paidAt. Write-once ATÓMICO: updateMany con guard
  // `payoutBatchId: null` → un re-run no re-toca filas ya asignadas ni pisa el
  // paidAtLegacy (que en la 1ª corrida = el paidAt original, aún sin reescribir).
  let written = 0;
  for (const [code, g] of groups) {
    const batch = batchByCode.get(code);
    const paymentAt = batch.paymentDate;
    for (const c of g.rows) {
      const res = await prisma.commission.updateMany({
        where: { id: c.id, payoutBatchId: null },
        data: {
          payoutBatchId: batch.id,
          paidAtLegacy: c.paidAt, // respaldo del stamp viejo (write-once)
          paidAt: paymentAt,
        },
      });
      if (res.count) written++;
    }
    // Total del lote = suma asignada.
    await prisma.payoutBatch.update({
      where: { id: batch.id },
      data: { totalUsd: g.total },
    });
  }
  console.log(`✅ ${written} comisiones asignadas + paidAt reescrito a la fecha del corte.`);

  // Verificación post-escritura.
  for (const [code, exp] of Object.entries(EXPECT)) {
    const rows = await prisma.commission.findMany({
      where: { payoutBatch: { code } },
      select: { amountPaid: true, paidAt: true },
    });
    const total = r2(rows.reduce((s, r) => s + Number(r.amountPaid), 0));
    const pdays = [...new Set(rows.map((r) => day(r.paidAt)))];
    console.log(`  ${code}: ${rows.length} filas · $${total} · paidAt=${pdays.join(',')}`);
  }
  await prisma.$disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
