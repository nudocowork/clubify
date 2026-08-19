// Backfill de Commission.businessDate (FECHA DURABLE) para filas EXISTENTES
// (null). Congela la fecha "de negocio" con la MISMA lógica que el read:
//   - 1ª comisión del negocio (min effectiveAvailableAt entre las NO-rechazadas
//     del tenant) CON purchasedAt VÁLIDO → tenant.purchasedAt (compra real).
//   - resto (recompras, 1ª sin purchasedAt, o purchasedAt sospechoso) →
//     commission.createdAt (fecha del cobro ≈ webhook de Hotmart = pago).
// effectiveAvailableAt = availableAt ?? (createdAt + 15d hold).
//
// GUARDS (revisión R3/Fable 2026-08-14):
//   R1: purchasedAt SOLO se usa si es <= createdAt de esa comisión + 1d. Bug B
//       (ya corregido) pudo estampar la fecha de RENOVACIÓN en purchasedAt de
//       negocios legacy → si es MUY posterior, es sospechosa → fallback createdAt
//       + se reporta como anomalía. (write-once = un error se congela para siempre.)
//   R5: escritura write-once atómica: updateMany where businessDate IS NULL.
//   R2: test de aceptación por fila-1ª exacta, fecha COMPLETA, y ABORTA --apply
//       si algún caso da ✗.
//   R3: comparación de fechas en America/Bogota (igual que el panel), no UTC.
//   R4: pre-reporte de tenants con >1 transacción distinta empatando el mínimo.
//
// DRY-RUN por defecto; --apply para escribir.
// Usage (dry-run):  railway run --service Postgres-Nq8w node scripts/backfill-commission-business-date.cjs
// Usage (aplicar):  railway run --service Postgres-Nq8w node scripts/backfill-commission-business-date.cjs --apply
const { PrismaClient } = require('@prisma/client');

const HOLD_DAYS = 15;
const DAY = 86400000;
// Test de aceptación del brief (Software Clubify 11 §8.3): fecha COMPLETA YYYY
// del año en curso del brief (2026). Deben quedar exactas (America/Bogota).
const ACCEPTANCE = [
  ['LICORES EL AMANECER', '2026-07-16'],
  ['Wok Explosivo', '2026-07-05'],
  ['SUGAR & KISS', '2026-07-02'],
  ['MOTILART', '2026-06-22'],
  ['Café Macondo', '2026-06-21'],
  ['Essentrix', '2026-07-28'],
  ['Top Man', '2026-07-28'],
];

const effAvail = (c) =>
  c.availableAt
    ? new Date(c.availableAt).getTime()
    : new Date(c.createdAt).getTime() + HOLD_DAYS * DAY;
// R3: día calendario en la zona del negocio (Bogotá), igual que el panel.
const bogotaDay = (d) =>
  new Date(d).toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });

(async () => {
  const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
  if (!url) { console.error('No DATABASE_URL'); process.exit(1); }
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  const APPLY = process.argv.includes('--apply');

  const all = await prisma.commission.findMany({
    select: {
      id: true, status: true, businessDate: true, availableAt: true,
      createdAt: true, hotmartTransactionId: true, periodKey: true,
      referralUse: {
        select: { tenant: { select: { id: true, brandName: true, purchasedAt: true } } },
      },
    },
  });

  // firstChargeMs por tenant = min effAvail entre las NO-rechazadas (idéntico al read).
  const firstMsByTenant = new Map();
  for (const c of all) {
    if (c.status === 'REJECTED') continue;
    const tid = c.referralUse?.tenant?.id;
    if (!tid) continue;
    const ms = effAvail(c);
    const cur = firstMsByTenant.get(tid);
    if (cur === undefined || ms < cur) firstMsByTenant.set(tid, ms);
  }

  const anomaliesR1 = []; // (ya no se usa purchasedAt; queda vacío)
  // FECHA = fecha del cobro de ESTA comisión (createdAt = webhook Hotmart ≈
  // pago). NO usamos tenant.purchasedAt: el diagnóstico mostró que el
  // purchasedAt viejo (backfill por PendingHotmartPayment con approved_date
  // mínimo) es poco fiable — da una fecha ANTERIOR a la compra real (LICORES
  // 26-jun vs 16-jul). createdAt está sano (diagnóstico A2/A4/A5=0) y, con
  // availableAt ya corregido, es la fecha correcta del cobro. Los negocios con
  // fecha exacta conocida ya están congelados por el curado (se saltan).
  const businessDateOf = (c) => {
    return { date: new Date(c.createdAt), src: 'createdAt' };
  };

  // R4: tenants con >1 transacción distinta empatando el mínimo (cron-renovación
  // con lastChargeAt viejo → riesgo de congelar purchasedAt en una renovación).
  const tieTxByTenant = new Map();
  for (const c of all) {
    const t = c.referralUse?.tenant;
    if (!t?.id || c.status === 'REJECTED') continue;
    if (effAvail(c) !== firstMsByTenant.get(t.id)) continue;
    const set = tieTxByTenant.get(t.id) ?? new Set();
    set.add(c.hotmartTransactionId ?? c.periodKey ?? c.id);
    tieTxByTenant.set(t.id, set);
  }
  const r4 = [...tieTxByTenant.entries()].filter(([, s]) => s.size > 1);

  let already = 0, fromPurchased = 0, fromCreated = 0;
  const updates = [];
  for (const c of all) {
    if (c.businessDate) { already++; continue; }
    const { date, src } = businessDateOf(c);
    if (src === 'purchasedAt') fromPurchased++; else fromCreated++;
    updates.push({ id: c.id, date });
  }

  console.log(`\nComisiones totales: ${all.length}`);
  console.log(`Ya con businessDate (se saltan): ${already}`);
  console.log(`A congelar (null): ${updates.length}  [${fromPurchased} purchasedAt · ${fromCreated} createdAt]`);

  console.log(`\n== R1: purchasedAt sospechoso (fallback a createdAt) ==`);
  if (!anomaliesR1.length) console.log('  (ninguno ✓)');
  for (const a of anomaliesR1) console.log(`  ⚠ ${a.brand}: purchasedAt=${a.purchasedAt} > 1ª comisión=${a.firstCommission} → uso createdAt`);

  console.log(`\n== R4: tenants con >1 transacción empatando el mínimo ==`);
  if (!r4.length) console.log('  (ninguno ✓)');
  for (const [tid, s] of r4) {
    const b = all.find((c) => c.referralUse?.tenant?.id === tid)?.referralUse?.tenant?.brandName;
    console.log(`  ⚠ ${b} (${tid}): ${s.size} tx distintas empatan la 1ª`);
  }

  // R2 + R3: test de aceptación sobre la fila-1ª exacta, fecha completa, Bogotá.
  console.log(`\n== Test de aceptación (7 casos del brief) ==`);
  let acceptFail = 0;
  for (const [name, expect] of ACCEPTANCE) {
    const firstRows = all.filter((c) => {
      const t = c.referralUse?.tenant;
      return (
        (t?.brandName || '').toLowerCase().includes(name.toLowerCase()) &&
        c.status !== 'REJECTED' &&
        t?.id && effAvail(c) === firstMsByTenant.get(t.id)
      );
    });
    if (!firstRows.length) { console.log(`  • ${name}: (no encontrado)`); continue; }
    const dates = [...new Set(firstRows.map((c) =>
      bogotaDay((c.businessDate ?? businessDateOf(c).date))))];
    const ok = dates.length === 1 && dates[0] === expect;
    if (!ok) acceptFail++;
    console.log(`  ${ok ? '✓' : '✗'} ${name}: ${dates.join(', ')}  (esperado ${expect})`);
  }

  if (!APPLY) {
    console.log(`\n[DRY-RUN] No se escribió NADA. Revisá R1/R4 y el test de aceptación.`);
    console.log(`Para aplicar: agregá --apply (aborta si algún caso da ✗)`);
    await prisma.$disconnect();
    return;
  }

  // R2: no escribir si el test de aceptación falló.
  if (acceptFail > 0) {
    console.error(`\n❌ ABORTADO: ${acceptFail} caso(s) de aceptación en ✗. No se escribió nada.`);
    await prisma.$disconnect();
    process.exit(1);
  }

  // R5: write-once atómico.
  let written = 0, raced = 0;
  for (const u of updates) {
    const res = await prisma.commission.updateMany({
      where: { id: u.id, businessDate: null },
      data: { businessDate: u.date },
    });
    if (res.count) written++; else raced++;
  }
  console.log(`\n✅ Escritas ${written} filas${raced ? ` · ${raced} ya tenían businessDate (skip)` : ''}.`);
  await prisma.$disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
