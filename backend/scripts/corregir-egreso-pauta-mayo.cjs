/**
 * Corrección puntual pedida por Javier (2026-09-29, PDF de solicitudes):
 *
 * El egreso «Pauta Publicitaria» del 31 de mayo de 2026 se registró por
 * $113.00, pero el valor real en dólares es $118.17. Se corrigen monto y
 * pagado (estaba pagado completo, así que el saldo sigue en $0).
 *
 * Verificado antes de escribir (lectura del 2026-09-29): es el único egreso
 * de pauta de esas fechas — id 994e9c11-4520-4252-8401-cb71d985ab21,
 * categoría Publicidad, PAID, USD, ámbito Clubify (whiteLabelId null).
 *
 * UPDATE condicional (id + amountUsd = 113): si alguien ya lo tocó, actualiza
 * 0 filas y no pisa nada. Correrlo dos veces no hace nada la segunda.
 *
 * Uso:  railway run --service Postgres-Nq8w node scripts/corregir-egreso-pauta-mayo.cjs
 */
const { PrismaClient } = require('@prisma/client');

(async () => {
  const prisma = new PrismaClient({
    datasourceUrl: process.env.DATABASE_PUBLIC_URL,
  });

  const n = await prisma.$executeRawUnsafe(`
    UPDATE "Expense"
    SET "amountUsd" = 118.17,
        "amountPaidUsd" = 118.17,
        note = 'Corregido el 2026-09-29 a pedido de Javier: se registró $113.00 pero el valor real en dólares de la pauta de mayo es $118.17.',
        "updatedAt" = now()
    WHERE id = '994e9c11-4520-4252-8401-cb71d985ab21'
      AND "amountUsd" = 113.00`);

  console.log(
    n === 1
      ? 'Corregido: 1 fila (113.00 → 118.17).'
      : `OJO: se actualizaron ${n} filas. O ya estaba corregido, o alguien lo tocó antes.`,
  );

  const [r] = await prisma.$queryRawUnsafe(`
    SELECT concept, "amountUsd", "amountPaidUsd", status, note
    FROM "Expense" WHERE id = '994e9c11-4520-4252-8401-cb71d985ab21'`);
  console.log('Como quedó:', JSON.stringify(r, null, 2));

  await prisma.$disconnect();
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
