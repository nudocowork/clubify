/**
 * Recalcula el ciclo de un pago manual desde su FECHA DE PAGO.
 *
 * Para reparar los registros hechos antes del 2026-08-21, cuando el ciclo se
 * calculaba desde "hoy" encadenando con `currentPeriodEnd` en vez de usar la
 * fecha que había escrito el usuario.
 *
 * Uso:  railway run node scripts/corregir-ciclo-pago-manual.cjs <idDelPago> [--aplicar]
 *       railway run node scripts/corregir-ciclo-pago-manual.cjs --todos
 */
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
const MESES = { MENSUAL: 1, TRIMESTRAL: 3, SEMESTRAL: 6, ANUAL: 12 };
const APLICAR = process.argv.includes('--aplicar');
const TODOS = process.argv.includes('--todos');
// Solo argumentos DESPUES del script: si no, `argv` incluye la ruta del
// propio archivo y se toma como id (bug real de la primera version).
const ID = process.argv.slice(2).find((a) => !a.startsWith('--') && /^[0-9a-f-]{36}$/i.test(a));

/** Mismo cálculo que `addPlanPeriod`: acota el día al último del mes destino. */
function sumar(desde, periodicidad) {
  const d = new Date(desde);
  const dia = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + (MESES[periodicidad] ?? 1));
  const ultimo = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(dia, ultimo));
  return d;
}
const f = (d) => (d ? new Date(d).toISOString().slice(0, 10) : '—');

(async () => {
  const pagos = await p.$queryRawUnsafe(
    ID
      ? `SELECT m.*, t.name AS negocio, t."planPeriodicity" AS perTenant, t."currentPeriodEnd" AS cpe
           FROM "ManualPayment" m JOIN "Tenant" t ON t.id = m."tenantId" WHERE m.id = '${ID}'`
      : `SELECT m.*, t.name AS negocio, t."planPeriodicity" AS perTenant, t."currentPeriodEnd" AS cpe
           FROM "ManualPayment" m JOIN "Tenant" t ON t.id = m."tenantId" ORDER BY m."createdAt"`,
  );
  if (!pagos.length) return console.log('No hay pagos manuales que revisar.') || p.$disconnect();

  for (const m of pagos) {
    const per = m.periodicity || m.perTenant || 'MENSUAL';
    const inicioOk = new Date(m.paidAt);
    const finOk = sumar(inicioOk, per);
    const malo =
      f(m.periodStart) !== f(inicioOk) || f(m.periodEnd) !== f(finOk);
    console.log(`\n▸ ${m.negocio}  (${per})  pago ${f(m.paidAt)}`);
    console.log(`   guardado: ${f(m.periodStart)} → ${f(m.periodEnd)}`);
    console.log(`   correcto: ${f(inicioOk)} → ${f(finOk)}   ${malo ? '*** HAY QUE CORREGIR ***' : 'ok'}`);
    console.log(`   próximo cobro del negocio ahora: ${f(m.cpe)}`);
    if (!malo || (!APLICAR && !TODOS)) continue;
    if (!APLICAR) { console.log('   [simulación] repite con --aplicar'); continue; }
    await p.$executeRawUnsafe(
      `UPDATE "ManualPayment" SET "periodStart" = $1, "periodEnd" = $2, "periodicity" = $3 WHERE id = $4`,
      inicioOk, finOk, per, m.id,
    );
    // El próximo cobro del negocio pasa a ser el fin del ciclo cubierto.
    await p.$executeRawUnsafe(
      `UPDATE "Tenant" SET "currentPeriodEnd" = $1 WHERE id = $2`, finOk, m.tenantId,
    );
    console.log(`   ✓ corregido. Próximo cobro del negocio → ${f(finOk)}`);
  }
  if (!APLICAR) console.log('\n(nada se escribió — usa --aplicar)');
  await p.$disconnect();
})().catch(async (e) => { console.error(e.message); await p.$disconnect(); process.exit(1); });
