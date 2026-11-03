#!/usr/bin/env node
/**
 * Segunda tanda de correcciones del cierre de octubre (Javier, 2026-11-03,
 * bitácora 176). Sin `--aplicar` solo muestra lo que haría.
 *
 *   railway run --service backend --environment production \
 *     --project ba90d94d-7e6d-4056-85ad-0e3f24e8d43a \
 *     node scripts/corregir-abonos-y-comisiones-2026-11.cjs [--aplicar]
 *
 *  1. Ventas con ABONO contadas dos veces. Los 20 del abono ya estaban en el
 *     libro y el restante se registró por el plan completo (Las Ricuras:
 *     20 + 150 = 170 por un trimestral de 150). El restante pasa a lo que se
 *     cobró: 48 / 130 / 480. La comisión del closer NO cambia: sigue sobre el
 *     plan completo, que es lo que Javier quiere.
 *  2. El Carrito: la comisión de Nicolás Quintero pasa de 6,80 (10 % de 68) a
 *     2,50 (10 % de la Mensualidad básica de 25). Autorizada por Javier.
 *  3. la burguesía: paga el «mensual start» de 50 (oferta vkfveas1), no el
 *     trimestral de 150. La comisión de octubre de TeamClosers pasa de 7,50 a
 *     2,50.
 *  4. El 2 % de Sara de las quincenas de octubre que sigan sin pagar se
 *     recalcula con la base corregida, y se rehace el total de su corte.
 *
 * NO toca Café Macondo: paga la misma oferta de 50 que la burguesía y Javier
 * pidió tomarlo como mensual de 68; queda a su decisión. Tampoco las
 * comisiones ya pagadas (la burguesía de septiembre: 7,50 pagados por 2,50).
 *
 * Cada paso comprueba que el dato sigue como se auditó. Idempotente.
 */
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const APLICAR = process.argv.includes('--aplicar');
const r2 = (n) => Math.round(n * 100) / 100;
const CLUBIFY = 'dfd3cdff-7836-4aee-96a4-d7fa2b2907be';
const HOY = '2026-11-03';

const paso = (s) => console.log(s);

async function pct(key, def) {
  const s = await prisma.setting.findUnique({ where: { key } }).catch(() => null);
  const n = Number(String(s?.value ?? def).replace(',', '.'));
  return Number.isFinite(n) ? n : def;
}

/** Mismo desglose que IncomeRecordService (fee 8,6 % fijo en USD). */
async function desglose(gross) {
  const feePct = await pct('finance.gatewayFeePct.HOTMART', 0);
  const taxPct = await pct('finance.taxPct', 0);
  const base = await prisma.setting.findUnique({ where: { key: 'finance.taxBase' } }).catch(() => null);
  const included = (base?.value ?? 'gross').trim() === 'included';
  const fee = r2((gross * feePct) / 100);
  const tax = included ? r2(gross - gross / (1 + taxPct / 100)) : r2((gross * taxPct) / 100);
  return { gatewayFeeUsd: fee, taxUsd: tax, netExpectedUsd: r2(gross - fee - tax) };
}

async function corregirIngreso(tx, esperado, nuevo, motivo) {
  const r = await prisma.incomeRecord.findUnique({ where: { gateway_externalTxId: { gateway: 'HOTMART', externalTxId: tx } } });
  if (!r) return paso(`  ✗ ingreso ${tx} no existe — salto`);
  if (Number(r.grossUsd) === nuevo) return paso(`  = ${tx} ${r.brandName ?? ''} ya está en ${nuevo}`);
  if (Number(r.grossUsd) !== esperado) return paso(`  ✗ ${tx} ${r.brandName ?? ''} está en ${r.grossUsd} (esperaba ${esperado}) — salto`);
  const d = await desglose(nuevo);
  paso(`  → ${tx} ${r.brandName ?? ''} (${r.saleDate.toISOString().slice(0, 10)}): ${esperado} → ${nuevo}`);
  if (APLICAR) {
    await prisma.incomeRecord.update({
      where: { id: r.id },
      data: { grossUsd: nuevo, ...d, note: `${r.note ? r.note + '\n' : ''}[${HOY}] ${motivo}` },
    });
  }
}

async function corregirComision(id, nombre, esperado, nuevo, base, motivo) {
  const c = await prisma.commission.findUnique({ where: { id } });
  if (!c) return paso(`  ✗ comisión de ${nombre} no existe — salto`);
  if (Number(c.amount) === nuevo) return paso(`  = comisión de ${nombre} ya está en ${nuevo}`);
  if (Number(c.amount) !== esperado || c.status === 'REJECTED' || c.paymentStatus !== 'PENDING' || Number(c.amountPaid) > 0) {
    return paso(`  ✗ comisión de ${nombre} está en ${c.amount} ${c.status}/${c.paymentStatus} — salto`);
  }
  paso(`  → comisión de ${nombre}: ${esperado} → ${nuevo} (base ${c.baseAmountUsd ?? '—'} → ${base})${c.payoutBatchId ? ' — está en un corte' : ''}`);
  if (APLICAR) {
    await prisma.commission.update({
      where: { id },
      data: { amount: nuevo, baseAmountUsd: base, notes: `${c.notes ? c.notes + '\n' : ''}[${HOY}] ${motivo}` },
    });
  }
}

async function rehacerCorte(batchId) {
  const lote = await prisma.payoutBatch.findUnique({ where: { id: batchId } });
  const a = await prisma.commission.aggregate({ where: { payoutBatchId: batchId, status: { not: 'REJECTED' } }, _sum: { amount: true } });
  const total = r2(Number(a._sum.amount ?? 0));
  if (Number(lote.totalUsd) === total) return paso(`  = total de ${lote.code} sigue en ${total}`);
  paso(`  → total de ${lote.code} (${lote.status}): ${lote.totalUsd} → ${total}`);
  if (APLICAR) await prisma.payoutBatch.update({ where: { id: batchId }, data: { totalUsd: total } });
}

(async () => {
  console.log(APLICAR ? '=== APLICANDO ===' : '=== ENSAYO (sin --aplicar no se escribe nada) ===');

  paso('\n1. Ventas con abono: el restante es lo cobrado, no el plan completo');
  const motivo = (plan, abono) => `Restante de un plan con abono: ${plan} − 20 de abono = ${abono}. Los 20 ya están en el libro aparte (Javier).`;
  await corregirIngreso('HP0565850960', 150, 130, motivo(150, 130)); // Las Ricuras, 18-oct
  await corregirIngreso('HP1253300365', 500, 480, motivo(500, 480)); // Alquimia, 13-oct
  await corregirIngreso('HP2343708499', 150, 130, motivo(150, 130)); // Segundo Piso, sep
  await corregirIngreso('HP4086347797', 150, 130, motivo(150, 130)); // Chillin, sep
  await corregirIngreso('HP3314964002', 68, 48, motivo(68, 48)); // Paicoat, sep
  await corregirIngreso('HP2515640948', 68, 48, motivo(68, 48)); // Chanfle, ago

  paso('\n2. El Carrito');
  await corregirComision('b1592a7a-533e-42d3-8c17-878c47a7afd4', 'Nicolás Quintero (El Carrito)', 6.8, 2.5, 25,
    'Mensualidad básica de 25, no el mensual de 68: 10 % = 2,50 (autorizado por Javier).');

  paso('\n3. la burguesía');
  await corregirComision('fa5b94db-c73d-461e-b451-1a70b79555df', 'TeamClosers (la burguesía, oct)', 7.5, 2.5, 50,
    'Paga el mensual start de 50 (oferta vkfveas1), no el trimestral de 150: 10 % = 2,50 (Javier).');

  paso('\n4. 2 % de Sara (quincenas de octubre sin pagar)');
  const lotes = new Set();
  for (const [clave, desde, hasta] of [
    ['EQUIPO-2026-10-15', '2026-10-01T05:00:00Z', '2026-10-16T05:00:00Z'],
    ['EQUIPO-2026-10-31', '2026-10-16T05:00:00Z', '2026-11-01T05:00:00Z'],
  ]) {
    const eq = await prisma.commission.findFirst({ where: { periodKey: clave } });
    if (!eq) { paso(`  ✗ ${clave} no existe — salto`); continue; }
    const agg = await prisma.incomeRecord.aggregate({
      where: { status: 'PAGADO', payerWhiteLabelId: null, whiteLabelId: CLUBIFY, saleDate: { gte: new Date(desde), lt: new Date(hasta) } },
      _sum: { grossUsd: true },
    });
    // En ensayo la base todavía no tiene las correcciones del paso 1.
    const base = r2(Number(agg._sum.grossUsd ?? 0));
    const nuevo = r2((base * 2) / 100);
    if (eq.paymentStatus !== 'PENDING' || Number(eq.amountPaid) > 0) {
      paso(`  = ${clave} ya pagada (${eq.amount}) — no se toca; con la base corregida serían ${nuevo}`);
      continue;
    }
    paso(`  → ${clave}: ${eq.amount} sobre ${eq.baseAmountUsd} → ${nuevo} sobre ${base}${APLICAR ? '' : ' (en ensayo, base sin corregir)'}`);
    if (APLICAR) {
      const [ini, fin] = [desde.slice(0, 10), clave.slice(7)];
      await prisma.commission.update({
        where: { id: eq.id },
        data: { amount: nuevo, baseAmountUsd: base, notes: `Comisión de equipo: 2% de las ventas del ${ini} al ${fin} ($${base.toFixed(2)}, de Contabilidad).` },
      });
    }
    if (eq.payoutBatchId) lotes.add(eq.payoutBatchId);
  }
  for (const c of await prisma.commission.findMany({
    where: { id: { in: ['b1592a7a-533e-42d3-8c17-878c47a7afd4', 'fa5b94db-c73d-461e-b451-1a70b79555df'] }, payoutBatchId: { not: null } },
    select: { payoutBatchId: true },
  })) lotes.add(c.payoutBatchId);
  for (const id of lotes) await rehacerCorte(id);

  const oct = await prisma.incomeRecord.aggregate({
    where: { status: 'PAGADO', payerWhiteLabelId: null, whiteLabelId: CLUBIFY, saleDate: { gte: new Date('2026-10-01T05:00:00Z'), lt: new Date('2026-11-01T05:00:00Z') } },
    _sum: { grossUsd: true }, _count: true,
  });
  paso(`\nOctubre en Contabilidad: USD ${r2(Number(oct._sum.grossUsd ?? 0))} en ${oct._count} cobros`);
})()
  .catch((e) => { console.error('ERROR', e.message); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
