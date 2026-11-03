#!/usr/bin/env node
/**
 * Tercera tanda del cierre de octubre (Javier, 2026-11-03, bitácora 177).
 * Sin `--aplicar` solo muestra lo que haría.
 *
 *   railway run --service backend --environment production \
 *     --project ba90d94d-7e6d-4056-85ad-0e3f24e8d43a \
 *     node scripts/corregir-egresos-y-macondo-2026-11.cjs [--aplicar] [--tasa=3166.91]
 *
 *  1. Septiembre: se borra el egreso «Comisión 2% Sara» de 71,48 (30-sep,
 *     categoría Comisiones). Es el 2 % del corte del 15 al 30 de septiembre,
 *     que ya está en Comisiones (EQUIPO-2026-09-30, pagada el 16-oct): estaba
 *     restado dos veces. Se imprime la fila completa antes de borrarla.
 *  2. Octubre: «Pauta Publicitaria Octubre» quedó en 1,26 USD; lo pagado fueron
 *     1.263.338 COP. Se pasa a USD con la TRM del 30-oct-2026 (3.166,91, la
 *     vigente el sábado 31) salvo que se dé otra con --tasa.
 *  3. Café Macondo paga el mensual start de 50 (oferta vkfveas1), igual que
 *     El Tiros y la burguesía (confirmado por Javier):
 *       - comisión de octubre 5,22 → 5,00 (10 % de 50);
 *       - ingreso de septiembre 52,24 → 50 (el precio sale del NOMBRE del plan,
 *         nunca del monto con cambio de moneda). El 2 % de Sara de esa
 *         quincena ya se pagó y no se toca: son 0,04.
 *
 * Cada paso comprueba que el dato sigue como se auditó. Idempotente.
 */
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const APLICAR = process.argv.includes('--aplicar');
const argTasa = process.argv.find((a) => a.startsWith('--tasa='));
const TASA = argTasa ? Number(argTasa.slice(7).replace(',', '.')) : 3166.91;
const r2 = (n) => Math.round(n * 100) / 100;
const HOY = '2026-11-03';
const paso = (s) => console.log(s);

async function pct(key, def) {
  const s = await prisma.setting.findUnique({ where: { key } }).catch(() => null);
  const n = Number(String(s?.value ?? def).replace(',', '.'));
  return Number.isFinite(n) ? n : def;
}
async function desglose(gross) {
  const feePct = await pct('finance.gatewayFeePct.HOTMART', 0);
  const taxPct = await pct('finance.taxPct', 0);
  const base = await prisma.setting.findUnique({ where: { key: 'finance.taxBase' } }).catch(() => null);
  const included = (base?.value ?? 'gross').trim() === 'included';
  const fee = r2((gross * feePct) / 100);
  const tax = included ? r2(gross - gross / (1 + taxPct / 100)) : r2((gross * taxPct) / 100);
  return { gatewayFeeUsd: fee, taxUsd: tax, netExpectedUsd: r2(gross - fee - tax) };
}

(async () => {
  if (!Number.isFinite(TASA) || TASA < 1000 || TASA > 10000) throw new Error(`TRM inválida: ${TASA}`);
  console.log(APLICAR ? '=== APLICANDO ===' : '=== ENSAYO (sin --aplicar no se escribe nada) ===');

  paso('\n1. Septiembre: egreso «Comisión 2% Sara» de 71,48 duplicado');
  const dup = await prisma.expense.findUnique({ where: { id: '4a9e9b67-6943-4f37-a027-fe5d56e5b512' } });
  if (!dup) paso('  = ya no existe');
  else if (Number(dup.amountUsd) !== 71.48 || !/2% Sara/i.test(dup.concept)) paso(`  ✗ cambió (${dup.concept} ${dup.amountUsd}) — salto`);
  else {
    paso(`  → borrar: ${JSON.stringify(dup)}`);
    if (APLICAR) await prisma.expense.delete({ where: { id: dup.id } });
  }

  paso('\n2. Octubre: Pauta Publicitaria Octubre en pesos');
  const COP = 1263338;
  const usd = r2(COP / TASA);
  const pauta = await prisma.expense.findUnique({ where: { id: '16fc92ac-4c01-4f08-a944-233081e5a231' } });
  if (!pauta) paso('  ✗ no existe — salto');
  else if (Number(pauta.amountUsd) === usd) paso(`  = ya está en ${usd}`);
  else if (Number(pauta.amountUsd) !== 1.26) paso(`  ✗ está en ${pauta.amountUsd} (esperaba 1.26) — salto`);
  else {
    paso(`  → 1,26 → ${usd} USD (1.263.338 COP / ${TASA})`);
    if (APLICAR) {
      await prisma.expense.update({
        where: { id: pauta.id },
        data: {
          amountUsd: usd,
          amountPaidUsd: pauta.status === 'PAID' ? usd : pauta.amountPaidUsd,
          note: `${pauta.note ? pauta.note + '\n' : ''}[${HOY}] Pagado 1.263.338 COP; en USD a TRM ${TASA}. Estaba en 1,26 (Javier).`,
        },
      });
    }
  }

  paso('\n3. Café Macondo (mensual start de 50)');
  const com = await prisma.commission.findUnique({ where: { id: '075b4e99-4c8e-4431-bceb-8380ced44f96' } });
  if (!com) paso('  ✗ comisión no existe — salto');
  else if (Number(com.amount) === 5) paso('  = comisión ya está en 5,00');
  else if (Number(com.amount) !== 5.22 || com.paymentStatus !== 'PENDING' || Number(com.amountPaid) > 0 || com.status === 'REJECTED') {
    paso(`  ✗ comisión está en ${com.amount} ${com.status}/${com.paymentStatus} — salto`);
  } else {
    paso(`  → comisión de octubre 5,22 → 5,00 (base 50)${com.payoutBatchId ? ' — está en un corte' : ''}`);
    if (APLICAR) {
      await prisma.commission.update({
        where: { id: com.id },
        data: { amount: 5, baseAmountUsd: 50, notes: `${com.notes ? com.notes + '\n' : ''}[${HOY}] Mensual start de 50 (oferta vkfveas1): 10 % = 5,00 (Javier).` },
      });
    }
  }
  const inc = await prisma.incomeRecord.findUnique({ where: { gateway_externalTxId: { gateway: 'HOTMART', externalTxId: 'HP3836714159' } } });
  if (!inc) paso('  ✗ ingreso de septiembre no existe — salto');
  else if (Number(inc.grossUsd) === 50) paso('  = ingreso de septiembre ya está en 50');
  else if (Number(inc.grossUsd) !== 52.24) paso(`  ✗ ingreso de septiembre está en ${inc.grossUsd} — salto`);
  else {
    paso('  → ingreso de septiembre 52,24 → 50');
    if (APLICAR) {
      await prisma.incomeRecord.update({
        where: { id: inc.id },
        data: { grossUsd: 50, ...(await desglose(50)), note: `${inc.note ? inc.note + '\n' : ''}[${HOY}] Mensual start de 50: el precio sale del nombre del plan, no del cambio de moneda (Javier).` },
      });
    }
  }
})()
  .catch((e) => { console.error('ERROR', e.message); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
