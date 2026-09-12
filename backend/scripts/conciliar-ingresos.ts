/**
 * Corre el conciliador de ingresos contra una base real.
 *
 * Usa las MISMAS clases que el backend (`ConciliadorDeIngresosService` +
 * `IncomeRecordService`), instanciadas a mano con un PrismaClient: si el
 * script tuviera su propia copia de la lógica, acabarían diciendo cosas
 * distintas — que es justo lo que este módulo tiene que dejar de hacer.
 *
 * Por defecto SIMULA: enseña qué escribiría y no toca nada.
 *
 *   railway run --service Postgres-Nq8w npx ts-node scripts/conciliar-ingresos.ts
 *   railway run --service Postgres-Nq8w npx ts-node scripts/conciliar-ingresos.ts --aplicar
 */
import { PrismaClient } from '@prisma/client';
import { IncomeRecordService } from '../src/finance/income-record.service';
import { ConciliadorDeIngresosService } from '../src/finance/conciliador-de-ingresos.service';

const APLICAR = process.argv.includes('--aplicar');
const usd = (n: number) => '$ ' + n.toFixed(2);

async function main() {
  const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
  if (!url) throw new Error('No DATABASE_URL');
  const prisma = new PrismaClient({ datasources: { db: { url } } });

  const income = new IncomeRecordService(prisma as never);
  const conciliador = new ConciliadorDeIngresosService(
    prisma as never,
    income,
  );

  const informe = await conciliador.conciliar({ simular: !APLICAR });

  console.log(informe.simulado ? '── SIMULACIÓN ──\n' : '── APLICADO ──\n');
  console.log(`eventos de cobro revisados: ${informe.revisados}`);
  console.log(`ingresos que ya estaban en el libro: ${informe.yaEstaban}`);
  console.log(`\nA ESCRIBIR: ${informe.creados.length}`);
  let total = 0;
  for (const c of informe.creados) {
    total += c.grossUsd;
    console.log(
      `  ${c.saleDate.slice(0, 10)} ${c.gateway.padEnd(7)} ${usd(c.grossUsd).padStart(9)} ` +
        `${(c.tenant ?? 'sin negocio').slice(0, 26).padEnd(26)} ${c.categoria.padEnd(11)} ` +
        `tx=${c.externalTxId}`,
    );
  }
  if (informe.creados.length) console.log(`  ── total ${usd(total)}`);

  console.log(
    `\nADOPTADOS (referencia de relleno -> la real): ${informe.adoptados.length}`,
  );
  for (const a of informe.adoptados) {
    console.log(`  ${a.brandName ?? '-'}: ${a.de} -> ${a.a}`);
  }

  console.log(
    `\nEN DISPUTA (siguen contando, hay que mirarlos): ${informe.enDisputa.length}`,
  );
  for (const t of informe.enDisputa) console.log(`  ${t}`);

  console.log(`\nDEVUELTOS (dejan de contar): ${informe.devueltos.length}`);
  for (const d of informe.devueltos) {
    console.log(`  ${d.externalTxId} → ${d.estado}`);
  }

  console.log(
    `\nAPUNTADOS SIN RESPALDO DE NINGUNA PASARELA: ${informe.sinRespaldo.length}`,
  );
  for (const x of informe.sinRespaldo) {
    console.log(
      `  ${x.saleDate.slice(0, 10)} ${x.gateway} ${usd(x.grossUsd)} ` +
        `${x.brandName ?? '-'} tx=${x.externalTxId}`,
    );
    console.log(`      nota: ${x.nota ?? '(sin nota)'}`);
  }

  console.log(`\nSIN RESOLVER: ${informe.sinResolver.length}`);
  for (const s of informe.sinResolver) {
    console.log(`  ${s.gateway} tx=${s.externalTxId} — ${s.motivo} (${s.pista ?? '—'})`);
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
