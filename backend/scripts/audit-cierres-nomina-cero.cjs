// READ-ONLY: qué cierres contables quedaron con la nómina en CERO.
//
// Usage: cd backend && railway run --service Postgres-Nq8w node scripts/audit-cierres-nomina-cero.cjs
//
// Hasta el arreglo del 2026-09-04, el reporte filtraba PayrollRun por
// `periodEnd`, y el panel creaba los cortes mandando solo `periodLabel` (texto
// libre) → `periodEnd` siempre null → la nómina no entraba en NINGÚN mes y la
// UTILIDAD del snapshot salía inflada por ese monto.
//
// Este script NO escribe nada: lista los cierres cuyo `nominaUsd` es 0 pero que
// tienen cortes de nómina en ese mes, y cuánta utilidad sobra en cada uno. Para
// corregir uno: reabrirlo y volver a cerrarlo desde el panel (Contabilidad →
// Cierres), ya con el cálculo arreglado.
const { PrismaClient } = require('@prisma/client');

// Mismo criterio que `common/periodo-contable.ts`: el mes va en hora de Bogotá.
const OFFSET_BOGOTA_HORAS = 5;
const limitesDelMes = (periodo) => {
  const m = /^(\d{4})-(\d{2})$/.exec(periodo);
  if (!m) return null;
  const y = Number(m[1]);
  const mes = Number(m[2]);
  return {
    from: new Date(Date.UTC(y, mes - 1, 1, OFFSET_BOGOTA_HORAS, 0, 0, 0)),
    to: new Date(Date.UTC(y, mes, 0, 23 + OFFSET_BOGOTA_HORAS, 59, 59, 999)),
  };
};
const money = (n) => '$' + Number(n).toFixed(2);

(async () => {
  const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
  // Sin `railway run`, la URL del .env apunta a la base LOCAL —normalmente
  // vacía— y el script respondería "todos los cierres cuadran" sin haber
  // mirado producción. Un falso "está todo bien" es peor que un error.
  if (!url) {
    console.error('No hay DATABASE_URL. Corré:\n  cd backend && railway run --service Postgres-Nq8w node scripts/audit-cierres-nomina-cero.cjs');
    process.exit(1);
  }
  if (/@(localhost|127\.0\.0\.1)[:/]/.test(url)) {
    console.error('La base es LOCAL, no producción. Este diagnóstico no sirve contra local.\n  cd backend && railway run --service Postgres-Nq8w node scripts/audit-cierres-nomina-cero.cjs');
    process.exit(1);
  }
  const p = new PrismaClient({ datasources: { db: { url } } });
  const cierres = await p.financialClose.findMany({ orderBy: { period: 'desc' } });
  if (cierres.length === 0) {
    console.log('No hay cierres guardados: no hay nada que recalcular.');
    await p.$disconnect();
    return;
  }
  console.log(`Cierres guardados: ${cierres.length}\n`);
  let sospechosos = 0;
  for (const c of cierres) {
    const b = limitesDelMes(c.period);
    if (!b) { console.log(`· ${c.period} (${c.scope}): período con formato raro, se salta`); continue; }
    const runs = await p.payrollRun.findMany({
      where: {
        ...(c.scope === 'all' ? {} : { whiteLabelId: null }),
        OR: [
          { periodEnd: { gte: b.from, lte: b.to } },
          { periodEnd: null, createdAt: { gte: b.from, lte: b.to } },
        ],
      },
      select: { periodLabel: true, totalUsd: true, periodEnd: true },
    });
    const real = runs.reduce((a, r) => a + Number(r.totalUsd), 0);
    const guardada = Number(c.nominaUsd);
    const dif = Math.round((real - guardada) * 100) / 100;
    if (Math.abs(dif) < 0.01) {
      console.log(`✓ ${c.period} (${c.scope}): nómina ${money(guardada)} — cuadra`);
      continue;
    }
    sospechosos++;
    console.log(
      `✗ ${c.period} (${c.scope}): nómina guardada ${money(guardada)}, real ${money(real)} ` +
      `→ la utilidad ${money(c.utilidadUsd)} sobra en ${money(dif)}`,
    );
    for (const r of runs) {
      console.log(`     · ${r.periodLabel} — ${money(r.totalUsd)}${r.periodEnd ? '' : ' (sin periodEnd, contado por createdAt)'}`);
    }
  }
  console.log(
    sospechosos === 0
      ? '\nTodos los cierres cuadran. No hay que tocar nada.'
      : `\n${sospechosos} cierre(s) para reabrir y volver a cerrar desde el panel.`,
  );
  await p.$disconnect();
})();
