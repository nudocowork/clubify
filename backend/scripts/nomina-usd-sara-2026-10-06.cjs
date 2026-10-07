/**
 * Nómina en dólares de Samuel Navarro y Javier Montiel (Sara, 2026-10-06):
 *   mayo 228,5 · junio 242,5 · julio 260 · agosto 271,5 (septiembre sin monto).
 *
 * Es la misma corrección del 2026-10-02 («tomar el valor promedio en dólares»):
 * la nómina se paga en pesos y se apunta en USD, así que cambiar el monto NO es
 * un pago nuevo ni una devolución. Un corte que estaba pagado entero sigue
 * pagado entero con el monto nuevo; uno parcial conserva lo abonado.
 *
 * Toma el monto como MENSUAL POR PERSONA. Solo toca el mes en que cada persona
 * tiene UNA línea; si tiene dos (quincenas) o ninguna, lo dice y no escribe.
 * Septiembre no se toca.
 *
 *   railway run --service Postgres-Nq8w node scripts/nomina-usd-sara-2026-10-06.cjs [--aplicar]
 */
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient({
  datasources: { db: { url: process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL } },
});
const APLICAR = process.argv.includes('--aplicar');
const MONTOS = { '2026-05': 228.5, '2026-06': 242.5, '2026-07': 260, '2026-08': 271.5 };
const PERSONAS = ['samuel navarro', 'javier montiel'];
const r2 = (n) => Math.round(n * 100) / 100;
const sinTildes = (t) => t.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim();

(async () => {
  // El mes del corte: el de su fin de período, o el de su creación si no lo
  // trae (mismo respaldo que Contabilidad).
  const lineas = await p.$queryRawUnsafe(`
    SELECT i.id, i."runId", i."employeeName", i."baseUsd"::float AS base, i."bonusUsd"::float AS bono,
           i."deductionUsd"::float AS ded, i."totalUsd"::float AS total,
           r."periodLabel", to_char(coalesce(r."periodEnd", r."createdAt"), 'YYYY-MM') AS mes
      FROM "PayrollItem" i JOIN "PayrollRun" r ON r.id = i."runId"
     WHERE coalesce(r."periodEnd", r."createdAt") >= '2026-05-01'
       AND coalesce(r."periodEnd", r."createdAt") <  '2026-10-01'
     ORDER BY mes, i."employeeName"`);

  for (const persona of PERSONAS) {
    console.log(`\n${persona.replace(/\b\w/g, (c) => c.toUpperCase())}`);
    for (const mes of [...Object.keys(MONTOS), '2026-09']) {
      const suyas = lineas.filter((l) => l.mes === mes && sinTildes(l.employeeName).includes(persona));
      const nuevo = MONTOS[mes];
      const hoy = suyas.map((l) => `$${l.total} («${l.periodLabel}»)`).join(', ') || 'sin línea';
      if (nuevo == null) {
        console.log(`  ${mes}: ${hoy} — sin monto de Sara, no se toca`);
        continue;
      }
      if (suyas.length !== 1) {
        console.log(`  ${mes}: ${hoy} — ${suyas.length ? 'más de una línea' : 'no hay línea'}, NO se toca (decidir a mano)`);
        continue;
      }
      const l = suyas[0];
      // El monto nuevo es el TOTAL de la línea: se ajusta la base y se
      // conservan bono y deducción.
      const base = r2(nuevo - l.bono + l.ded);
      if (Math.abs(l.total - nuevo) < 0.005) {
        console.log(`  ${mes}: ya está en $${nuevo}`);
        continue;
      }
      console.log(`  ${mes}: $${l.total} → $${nuevo} («${l.periodLabel}») ${APLICAR ? 'APLICO' : 'simulo'}`);
      if (!APLICAR) continue;
      await p.$transaction(async (tx) => {
        const run = await tx.payrollRun.findUnique({
          where: { id: l.runId },
          select: { totalUsd: true, amountPaidUsd: true, paidAt: true },
        });
        const pagadoEntero = Number(run.amountPaidUsd) > 0 && Number(run.amountPaidUsd) >= Number(run.totalUsd) - 0.01;
        await tx.payrollItem.update({ where: { id: l.id }, data: { baseUsd: base, totalUsd: nuevo } });
        const items = await tx.payrollItem.findMany({ where: { runId: l.runId }, select: { totalUsd: true } });
        const total = r2(items.reduce((a, it) => a + Number(it.totalUsd), 0));
        const pagado = pagadoEntero ? total : Math.min(Number(run.amountPaidUsd), total);
        const status = pagado <= 0 ? 'PENDING' : pagado >= total - 0.01 ? 'PAID' : 'PARTIAL';
        await tx.payrollRun.update({
          where: { id: l.runId },
          data: {
            totalUsd: total,
            amountPaidUsd: pagado,
            status,
            ...(status !== 'PAID' ? { paidAt: null } : run.paidAt ? {} : { paidAt: new Date() }),
          },
        });
      });
    }
  }
  if (!APLICAR) console.log('\n(simulación: --aplicar para escribir)');
  await p.$disconnect();
})().catch(async (e) => {
  console.error('ERROR:', e.message);
  await p.$disconnect();
  process.exit(1);
});
