#!/usr/bin/env node
/**
 * La «Pauta Publicitaria Octubre» es en DÓLARES (Javier, 2026-11-03): 1.263,338
 * USD, no 1.263.338 COP. La entrada 177 la había pasado de pesos a USD (398,92)
 * por error. Queda en 1.263,34 USD. Sin `--aplicar` solo muestra.
 */
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const APLICAR = process.argv.includes('--aplicar');
const NUEVO = 1263.34;
(async () => {
  const e = await prisma.expense.findUnique({ where: { id: '16fc92ac-4c01-4f08-a944-233081e5a231' } });
  if (!e) return console.log('✗ el egreso no existe');
  const actual = Number(e.amountUsd);
  if (actual === NUEVO) return console.log('= ya está en 1263.34 USD');
  if (actual !== 398.92 && actual !== 1.26) return console.log(`✗ está en ${actual} (esperaba 398.92) — salto`);
  console.log(`${APLICAR ? 'APLICANDO' : 'ENSAYO'} → Pauta Publicitaria Octubre: ${actual} → ${NUEVO} USD`);
  if (APLICAR) {
    const note = (e.note ?? '').split('\n').filter((l) => !l.includes('COP')).join('\n');
    await prisma.expense.update({
      where: { id: e.id },
      data: {
        amountUsd: NUEVO,
        amountPaidUsd: e.status === 'PAID' ? NUEVO : e.amountPaidUsd,
        currency: 'USD',
        note: `${note ? note + '\n' : ''}[2026-11-03] Pauta de octubre: 1.263,34 USD (el monto es en dólares).`,
      },
    });
  }
})().catch((x) => { console.error('ERROR', x.message); process.exitCode = 1; }).finally(() => prisma.$disconnect());
