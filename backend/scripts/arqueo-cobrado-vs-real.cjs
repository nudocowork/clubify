/**
 * SOLO LECTURA: «Cobrado» del panel contra el dinero que de verdad entró.
 *
 * El panel NO suma pagos: cuenta NEGOCIOS con `lastChargeAt` dentro del rango
 * y le pone a cada uno el precio de su plan (`subscriptionPriceUsd` o el
 * canónico). O sea, un importe de LISTA, no el que cobró la pasarela.
 *
 * `IncomeRecord` sí tiene la transacción real, con su importe real y su fecha
 * real. Este arqueo pone los dos números uno al lado del otro para varios
 * rangos, que es justo lo que se ve mal en «Esta semana».
 */
const { PrismaClient } = require('@prisma/client');

const f = (d) => new Date(d).toISOString().slice(0, 16).replace('T', ' ');
const round2 = (n) => Math.round(n * 100) / 100;

// Los mismos precios canónicos que usa el panel.
const PERIODS = {
  MENSUAL: { months: 1, bundlePrice: 50 },
  TRIMESTRAL: { months: 3, bundlePrice: 135 },
  SEMESTRAL: { months: 6, bundlePrice: 255 },
  ANUAL: { months: 12, bundlePrice: 480 },
};
const norm = (p) => (p && PERIODS[p] ? p : 'MENSUAL');

function rangos(now) {
  const d = new Date(now);
  // Semana que empieza el LUNES.
  const dow = (d.getDay() + 6) % 7;
  const lunes = new Date(d);
  lunes.setDate(d.getDate() - dow);
  lunes.setHours(0, 0, 0, 0);
  const hoy = new Date(d);
  hoy.setHours(0, 0, 0, 0);
  const mes = new Date(d.getFullYear(), d.getMonth(), 1);
  return [
    ['hoy', hoy, d],
    ['esta semana', lunes, d],
    ['este mes', mes, d],
  ];
}

(async () => {
  const p = new PrismaClient();
  try {
    const now = new Date();
    for (const [nombre, from, to] of rangos(now)) {
      console.log(`\n${'='.repeat(64)}\n${nombre.toUpperCase()}  ${f(from)} → ${f(to)}`);

      // ── Como lo cuenta el PANEL ────────────────────────────────────
      const cobraronEnRango = await p.tenant.findMany({
        where: { lastChargeAt: { gte: from, lte: to } },
        select: {
          brandName: true,
          planPeriodicity: true,
          subscriptionPriceUsd: true,
          lastChargeAt: true,
        },
      });
      let panel = 0;
      console.log(`\n  PANEL — negocios con lastChargeAt en el rango: ${cobraronEnRango.length}`);
      for (const t of cobraronEnRango) {
        const precio =
          Number(t.subscriptionPriceUsd) > 0
            ? Number(t.subscriptionPriceUsd)
            : PERIODS[norm(t.planPeriodicity)].bundlePrice;
        panel += precio;
        console.log(
          `    ${(t.brandName ?? '').slice(0, 28).padEnd(30)} ` +
            `${norm(t.planPeriodicity).padEnd(11)} precio de lista $${precio}`,
        );
      }
      console.log(`  → «Cobrado» que pinta el panel: $${round2(panel)}`);

      // ── Lo que DE VERDAD entró ─────────────────────────────────────
      const reales = await p.incomeRecord.findMany({
        where: { saleDate: { gte: from, lte: to } },
        select: {
          brandName: true,
          grossUsd: true,
          gateway: true,
          saleDate: true,
          planPeriodicity: true,
          isFirstPayment: true,
        },
        orderBy: { saleDate: 'asc' },
      });
      let real = 0;
      console.log(`\n  REAL — transacciones en IncomeRecord: ${reales.length}`);
      for (const r of reales) {
        real += Number(r.grossUsd);
        console.log(
          `    ${f(r.saleDate)}  ${(r.brandName ?? '').slice(0, 24).padEnd(26)} ` +
            `${String(r.gateway).padEnd(8)} $${Number(r.grossUsd).toFixed(2)}` +
            `${r.isFirstPayment ? '  (primer pago)' : ''}`,
        );
      }
      console.log(`  → dinero real del rango: $${round2(real)}`);

      const dif = round2(real - panel);
      console.log(
        `\n  DIFERENCIA: ${dif >= 0 ? '+' : ''}$${dif}` +
          (Math.abs(dif) > 0.01 ? '   ← el panel no cuadra' : '   ✓'),
      );
    }
  } finally {
    await p.$disconnect();
  }
})();
