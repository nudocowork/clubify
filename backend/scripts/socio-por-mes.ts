/**
 * SOLO LECTURA. La parte del socio mes a mes, con las piezas de las que sale,
 * usando las clases REALES del módulo (no reimplementa consultas).
 *
 *   railway run --service Postgres-Nq8w npx ts-node --transpile-only scripts/socio-por-mes.ts
 */
import { PrismaClient } from '@prisma/client';
import { IncomeRecordService } from '../src/finance/income-record.service';
import { ExpenseService } from '../src/finance/expense.service';
import { FinanceReportService } from '../src/finance/finance-report.service';

async function main() {
  const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
  if (!url) throw new Error('No DATABASE_URL');
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  await prisma.$executeRawUnsafe('SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY');
  const income = new IncomeRecordService(prisma as never);
  const expense = new ExpenseService(prisma as never);
  const report = new FinanceReportService(prisma as never, income, expense);

  const meses = ['2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10'];
  const filas = [];
  for (const m of meses) {
    const r = report.monthBounds(m)!;
    const s = await report.summary(true, r.from, r.to);
    filas.push({
      mes: m,
      bruto: s.grossUsd,
      fee: s.gatewayFeeUsd,
      impuesto: s.taxUsd,
      neto: s.netUsd,
      egresos: s.egresosUsd,
      nomina: s.nominaUsd,
      comisionesPagadas: s.comisionesUsd,
      socio: s.socioUsd,
      pct: s.socioPorcentaje,
      utilidad: s.utilidadUsd,
      cobros: s.ingresosCount,
    });
  }
  console.table(filas);
  await prisma.$disconnect();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
