/**
 * Qué va a enseñar Contabilidad, calculado con SUS propias clases.
 *
 * No reimplementa las consultas: instancia `FinanceReportService` con un
 * PrismaClient real, así que lo que imprime es exactamente lo que devolverá el
 * endpoint. Es la única forma de verificar sin abrir el navegador y sin que el
 * script y el módulo puedan discrepar.
 *
 *   railway run --service Postgres-Nq8w npx ts-node scripts/verificar-contabilidad.ts
 */
import { PrismaClient } from '@prisma/client';
import { IncomeRecordService } from '../src/finance/income-record.service';
import { ExpenseService } from '../src/finance/expense.service';
import { FinanceReportService } from '../src/finance/finance-report.service';
import { MovementsService } from '../src/finance/movements.service';
import { limitesDelPeriodo } from '../src/common/periodo-contable';

const usd = (n: number) => '$ ' + n.toFixed(2);

async function main() {
  const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
  if (!url) throw new Error('No DATABASE_URL');
  const prisma = new PrismaClient({ datasources: { db: { url } } });

  const income = new IncomeRecordService(prisma as never);
  const expense = new ExpenseService(prisma as never);
  const report = new FinanceReportService(prisma as never, income, expense);
  const movs = new MovementsService(prisma as never);

  for (const periodo of ['2026-05', '2026-06', '2026-09', '2026-T3', 'todo']) {
    const r = limitesDelPeriodo(periodo) ?? {};
    const s = await report.summary(true, r.from, r.to);
    console.log(`\n════ ${periodo}   (${r.from?.toISOString().slice(0, 10) ?? '—'} → ${r.to?.toISOString().slice(0, 10) ?? '—'})`);
    console.log(`  Ventas brutas          ${usd(s.grossUsd).padStart(12)}   (${s.ingresosCount} cobros)`);
    console.log(`  − fee + impuestos      ${usd(s.gatewayFeeUsd + s.taxUsd).padStart(12)}`);
    console.log(`  = Neto esperado        ${usd(s.netUsd).padStart(12)}`);
    console.log(`  − egresos              ${usd(s.egresosUsd).padStart(12)}`);
    console.log(`  − nómina               ${usd(s.nominaUsd).padStart(12)}`);
    console.log(`  − comisiones PAGADAS   ${usd(s.comisionesUsd).padStart(12)}`);
    console.log(`  = UTILIDAD             ${usd(s.utilidadUsd).padStart(12)}`);
    console.log(`    comisiones generadas ${usd(s.comisionesGeneradasUsd).padStart(12)} · sin pagar ${usd(s.comisionesPendientesUsd)}`);
    if (s.refundedUsd) console.log(`    devuelto               ${usd(s.refundedUsd).padStart(12)}`);
    const cats = Object.entries(s.porCategoria)
      .map(([k, v]) => `${k} ${usd(v.grossUsd)} (${v.count})`)
      .join(' · ');
    if (cats) console.log(`    por clase: ${cats}`);
  }

  // El trimestre tiene que dar la suma de sus meses, no un número parecido.
  console.log('\n════ COMPROBACIÓN: el trimestre = la suma de sus meses');
  let suma = 0;
  for (const m of ['2026-07', '2026-08', '2026-09']) {
    const r = limitesDelPeriodo(m)!;
    const s = await report.summary(true, r.from, r.to);
    suma += s.grossUsd;
    console.log(`  ${m}  ${usd(s.grossUsd).padStart(12)}`);
  }
  const t = limitesDelPeriodo('2026-T3')!;
  const trimestre = await report.summary(true, t.from, t.to);
  console.log(`  ── suma de los tres  ${usd(Math.round(suma * 100) / 100).padStart(12)}`);
  console.log(`  ── el trimestre      ${usd(trimestre.grossUsd).padStart(12)}  ${Math.abs(suma - trimestre.grossUsd) < 0.01 ? 'CUADRA' : 'NO CUADRA'}`);

  // Y el libro de caja del mes, con las comisiones incluidas.
  const sep = limitesDelPeriodo('2026-09')!;
  const libro = await movs.list({ from: sep.from, to: sep.to, onlyClubify: true });
  console.log('\n════ MOVIMIENTOS DE SEPTIEMBRE');
  console.log(`  ${libro.summary.count} movimientos · entra ${usd(libro.summary.ingresosUsd)} · sale ${usd(libro.summary.egresosUsd)} · saldo ${usd(libro.summary.saldoUsd)}`);
  for (const m of libro.movements.slice(0, 12)) {
    console.log(
      `  ${m.date.slice(0, 10)} ${m.kind.padEnd(7)} ${m.category.slice(0, 18).padEnd(18)} ` +
        `${(m.party ?? m.concept).slice(0, 26).padEnd(26)} ` +
        `${m.creditUsd ? '+' + usd(m.creditUsd) : '-' + usd(m.debitUsd)}`,
    );
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
