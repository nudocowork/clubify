/**
 * Corrección puntual pedida por Javier (2026-09-29, PDF de solicitudes):
 *
 * El ingreso del UPGRADE a plan anual de «Habibi Bar Cantina» se registró por
 * $420, pero la cifra correcta es $432: el negocio ya había pagado una
 * mensualidad de $68 que se descontaba del anual. Se corrige el bruto y se
 * recalculan impuesto y neto con la MISMA tasa que traía el registro
 * (79.80 / 420 = 19 %): impuesto $82.08, neto esperado $349.92.
 *
 * Verificado antes de escribir (lectura del 2026-09-29): el registro es
 * cd7711d3-3e52-4dc4-a343-09cc4c43c939 — MANUAL, UPGRADE/ANUAL, periodo
 * 2026-09, sin conciliar (netReceivedUsd null, reconStatus PENDING), así que
 * no descuadra ninguna conciliación ya hecha.
 *
 * UPDATE condicional (id + grossUsd = 420): si alguien ya lo tocó, actualiza
 * 0 filas y no pisa nada. Correrlo dos veces no hace nada la segunda.
 *
 * Uso:  railway run --service Postgres-Nq8w node scripts/corregir-ingreso-habibi-432.cjs
 */
const { PrismaClient } = require('@prisma/client');

(async () => {
  const prisma = new PrismaClient({
    datasourceUrl: process.env.DATABASE_PUBLIC_URL,
  });

  const n = await prisma.$executeRawUnsafe(`
    UPDATE "IncomeRecord"
    SET "grossUsd" = 432.00,
        "taxUsd" = 82.08,
        "netExpectedUsd" = 349.92,
        note = 'Corregido el 2026-09-29 a pedido de Javier: el upgrade se registró por $420, pero el cobro real fue $432 (el negocio ya había pagado una mensualidad de $68). Impuesto recalculado al 19 %.',
        "updatedAt" = now()
    WHERE id = 'cd7711d3-3e52-4dc4-a343-09cc4c43c939'
      AND "grossUsd" = 420.00`);

  console.log(
    n === 1
      ? 'Corregido: 1 fila (420 → 432).'
      : `OJO: se actualizaron ${n} filas. O ya estaba corregido, o alguien lo tocó antes.`,
  );

  const [r] = await prisma.$queryRawUnsafe(`
    SELECT "grossUsd", "gatewayFeeUsd", "taxUsd", "netExpectedUsd", status, "reconStatus", note
    FROM "IncomeRecord"
    WHERE id = 'cd7711d3-3e52-4dc4-a343-09cc4c43c939'`);
  console.log('Como quedó:', JSON.stringify(r, null, 2));

  await prisma.$disconnect();
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
