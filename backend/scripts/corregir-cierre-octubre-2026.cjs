#!/usr/bin/env node
/**
 * Correcciones del cierre de octubre 2026 que Javier aprobó el 2026-11-03
 * (bitácora 174). Sin `--aplicar` solo muestra lo que haría.
 *
 *   railway run --service backend --environment production \
 *     node scripts/corregir-cierre-octubre-2026.cjs [--aplicar]
 *
 * Qué corrige, y por qué:
 *  1. ALTIERI: el «Paquete de Alianzas» (USD 16,85, HP0110063075) se tomó por
 *     una renovación semestral de 278. Vuelve su suscripción semestral
 *     (UPLT7WYL) y su vencimiento real (6-ene-2027); el ingreso pasa a ser un
 *     servicio adicional de 16,85 (suma al 2 % de Sara y al socio) y se anula
 *     la comisión de 27,80 del closer, que no corresponde a un plan.
 *  2. El Tiros Club y la burguesía: pagan el mensual de USD 50 (`vkfveas1`),
 *     no el trimestral de 150. Su ficha pasa a MENSUAL · 50 y el cobro de
 *     octubre a 50.
 *  3. El Carrito: Mensualidad básica de 25, no el mensual de 68.
 *  4. Café Macondo: su precio quedó en 52,24 (lo cobrado con cambio de
 *     moneda); el pactado es 50.
 *  5. Enchurrados: la comisión de Gabriel es del mismo pago que la de
 *     Nicolás (HP2381494175).
 *  6. Mística: la comisión del cobro del 17-oct no tenía fecha de venta.
 *  7. La oferta `vkfveas1` queda declarada (inactiva, no sale en los paneles)
 *     como mensual de 50, para que el webhook sepa qué plan es.
 *  8. El 2 % de Sara del corte del 31-oct se recalcula con la base corregida,
 *     igual que lo haría su cron de cada hora, y se rehace el total del corte.
 *
 * NO toca: las comisiones del próximo corte (la burguesía 7,50, El Carrito
 * 6,80, Café Macondo 5,22) — Javier pidió explicación antes de autorizarlas —,
 * ni los ingresos de septiembre (mes cerrado y 2 % de Sara ya pagado).
 *
 * Cada paso comprueba que el dato sigue como se auditó; si alguien ya lo
 * cambió, lo salta y lo dice. Idempotente.
 */
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const APLICAR = process.argv.includes('--aplicar');
const r2 = (n) => Math.round(n * 100) / 100;

const ALTIERI = '36c3b005-8479-4438-be35-938fa1f88e9a';
const TIROS = 'aac7e12a-2319-40f5-a26a-cd0bebeeb966';
const BURGUESIA = 'be71eacb-4202-427b-b5f1-333c96ded9bd';
const MACONDO = '574d80cd-ed7f-4da1-8848-7bc54bf0d79c';
const CORTE = 'CORTE-2026-10-31';

const log = [];
const paso = (s) => { log.push(s); console.log(s); };

async function pct(key, def) {
  const s = await prisma.setting.findUnique({ where: { key } }).catch(() => null);
  const n = Number(String(s?.value ?? def).replace(',', '.'));
  return Number.isFinite(n) ? n : def;
}

/** Mismo desglose que IncomeRecordService.desglose (fee 8,6 % fijo en USD). */
async function desglose(gross) {
  const feePct = await pct('finance.gatewayFeePct.HOTMART', 0);
  const taxPct = await pct('finance.taxPct', 0);
  const base = await prisma.setting.findUnique({ where: { key: 'finance.taxBase' } }).catch(() => null);
  const included = (base?.value ?? 'gross').trim() === 'included';
  const fee = r2((gross * feePct) / 100);
  const tax = included ? r2(gross - gross / (1 + taxPct / 100)) : r2((gross * taxPct) / 100);
  return { gatewayFeeUsd: fee, taxUsd: tax, netExpectedUsd: r2(gross - fee - tax) };
}

async function corregirIngreso(tx, esperado, nuevo, { motivo = '', ...extra } = {}) {
  const r = await prisma.incomeRecord.findUnique({ where: { gateway_externalTxId: { gateway: 'HOTMART', externalTxId: tx } } });
  if (!r) return paso(`  ✗ ingreso ${tx} no existe — salto`);
  if (Number(r.grossUsd) === nuevo && (!extra.category || r.category === extra.category)) return paso(`  = ingreso ${tx} ya está en ${nuevo}`);
  if (Number(r.grossUsd) !== esperado && Number(r.grossUsd) !== nuevo) return paso(`  ✗ ingreso ${tx} está en ${r.grossUsd} (esperaba ${esperado}) — salto`);
  const d = await desglose(nuevo);
  paso(`  → ingreso ${tx} ${r.brandName ?? ''}: ${r.grossUsd} → ${nuevo} (neto ${r.netExpectedUsd} → ${d.netExpectedUsd})${extra.category ? `, categoría ${r.category} → ${extra.category}` : ''}`);
  if (APLICAR) {
    await prisma.incomeRecord.update({
      where: { id: r.id },
      data: { grossUsd: nuevo, ...d, ...extra, note: `${r.note ? r.note + '\n' : ''}[2026-11-03] Cierre de octubre: ${esperado} → ${nuevo} (Javier). ${motivo}`.trim() },
    });
  }
}

(async () => {
  console.log(APLICAR ? '=== APLICANDO ===' : '=== ENSAYO (sin --aplicar no se escribe nada) ===');

  // 1. ALTIERI
  paso('\n1. ALTIERI');
  const alt = await prisma.tenant.findUnique({ where: { id: ALTIERI }, select: { hotmartSubscriberCode: true, currentPeriodEnd: true } });
  const julio = await prisma.$queryRawUnsafe(
    `SELECT (payload->'data'->'purchase'->>'date_next_charge')::bigint prox, (payload->'data'->'purchase'->>'approved_date')::bigint aprob
       FROM "HotmartWebhookEvent" WHERE payload->'data'->'purchase'->>'transaction' = 'HP3350724274' AND payload->>'event' = 'PURCHASE_APPROVED' LIMIT 1`);
  const vence = julio[0] ? new Date(Number(julio[0].prox)) : null;
  const cobro = julio[0] ? new Date(Number(julio[0].aprob)) : null;
  if (alt.hotmartSubscriberCode === '1CNGARX4' && vence) {
    paso(`  → suscripción 1CNGARX4 → UPLT7WYL; vence ${alt.currentPeriodEnd.toISOString().slice(0, 10)} → ${vence.toISOString().slice(0, 10)}`);
    if (APLICAR) {
      await prisma.tenant.update({
        where: { id: ALTIERI },
        data: { hotmartSubscriberCode: 'UPLT7WYL', hotmartTransactionId: 'HP3350724274', currentPeriodEnd: vence, lastChargeAt: cobro },
      });
    }
  } else paso(`  = suscripción ya es ${alt.hotmartSubscriberCode} — salto`);
  await corregirIngreso('HP0110063075', 278, 16.85, { category: 'OTRO', productName: 'Paquete de Alianzas', planPeriodicity: null, isFirstPayment: false, motivo: 'Servicio adicional, no renovación del semestral.' });
  const comAlt = await prisma.commission.findUnique({ where: { id: '8cf2d1ba-fe43-48bf-8d00-5effdf9a605b' } });
  if (comAlt && comAlt.status !== 'REJECTED' && comAlt.paymentStatus === 'PENDING' && Number(comAlt.amountPaid) === 0) {
    paso(`  → comisión ${comAlt.amount} de Nicolás Quintero anulada y fuera del corte`);
    if (APLICAR) {
      await prisma.commission.update({
        where: { id: comAlt.id },
        data: { status: 'REJECTED', payoutBatchId: null, notes: `${comAlt.notes ? comAlt.notes + '\n' : ''}[2026-11-03] Anulada: el cobro fue el Paquete de Alianzas (servicio adicional), no un plan. Javier.` },
      });
    }
  } else paso(`  = comisión de ALTIERI ya anulada o pagada (${comAlt?.status}/${comAlt?.paymentStatus}) — salto`);

  // 2. El Tiros y la burguesía
  for (const [nombre, id, tx] of [['El Tiros Club', TIROS, 'HP0433360468'], ['la burguesía', BURGUESIA, 'HP2847213770']]) {
    paso(`\n2. ${nombre}`);
    const t = await prisma.tenant.findUnique({ where: { id }, select: { planPeriodicity: true, subscriptionPriceUsd: true } });
    if (t.planPeriodicity === 'TRIMESTRAL') {
      paso(`  → plan TRIMESTRAL · ${t.subscriptionPriceUsd ?? '150 (canónico)'} → MENSUAL · 50`);
      if (APLICAR) await prisma.tenant.update({ where: { id }, data: { planPeriodicity: 'MENSUAL', subscriptionPriceUsd: 50 } });
    } else paso(`  = plan ya es ${t.planPeriodicity} · ${t.subscriptionPriceUsd}`);
    await corregirIngreso(tx, 150, 50, { planPeriodicity: 'MENSUAL', motivo: 'Pagó el mensual de 50 (vkfveas1), no el trimestral.' });
  }

  // 3. El Carrito
  paso('\n3. El Carrito de las Antojerías');
  await corregirIngreso('HP1022001691', 68, 25, { motivo: 'Mensualidad básica (shoro1ov).' });

  // 4. Café Macondo
  paso('\n4. Café Macondo');
  const mac = await prisma.tenant.findUnique({ where: { id: MACONDO }, select: { subscriptionPriceUsd: true } });
  if (Number(mac.subscriptionPriceUsd) === 52.24) {
    paso('  → precio del plan 52,24 → 50');
    if (APLICAR) await prisma.tenant.update({ where: { id: MACONDO }, data: { subscriptionPriceUsd: 50 } });
  } else paso(`  = precio del plan ya es ${mac.subscriptionPriceUsd}`);
  await corregirIngreso('HP0619761778', 52.24, 50, { motivo: 'Se toma el precio del plan, no lo cobrado con cambio de moneda.' });

  // 5. Enchurrados
  paso('\n5. Enchurrados — comisión de Gabriel');
  const gab = await prisma.commission.findUnique({ where: { id: '6e56ccf4-f0e5-4f1b-bc47-819bf9231bf2' } });
  if (gab && !gab.externalTxId) {
    paso('  → ligada al pago HP2381494175 (el mismo de Nicolás)');
    if (APLICAR) await prisma.commission.update({ where: { id: gab.id }, data: { externalTxId: 'HP2381494175' } });
  } else paso(`  = ya ligada a ${gab?.externalTxId}`);

  // 6. Mística
  paso('\n6. Mística — fecha de venta');
  const mis = await prisma.commission.findUnique({ where: { id: '4ef498fd-d7ab-4347-97af-1cd66da48ee0' } });
  const ingMis = await prisma.incomeRecord.findUnique({ where: { gateway_externalTxId: { gateway: 'HOTMART', externalTxId: 'HP2697959153' } } });
  if (mis && !mis.businessDate && ingMis) {
    paso(`  → fecha de venta ${ingMis.saleDate.toISOString()}`);
    if (APLICAR) await prisma.commission.update({ where: { id: mis.id }, data: { businessDate: ingMis.saleDate } });
  } else paso(`  = ya tiene fecha ${mis?.businessDate?.toISOString?.()}`);

  // 7. Oferta vkfveas1
  paso('\n7. Oferta vkfveas1 (mensual de 50)');
  const set = await prisma.setting.findUnique({ where: { key: 'landing.enlacesDeVenta' } });
  const enlaces = JSON.parse(set?.value || '[]');
  if (!enlaces.some((e) => /off=vkfveas1/i.test(e.url || ''))) {
    paso('  → se declara como MENSUAL · 50 (inactiva: no sale en los paneles)');
    enlaces.push({ id: 'mensual-50-anterior', nombre: 'Plan Mensual (precio anterior, 50)', tipo: 'NORMAL', periodicidad: 'MENSUAL', precioUsd: 50, url: 'https://pay.hotmart.com/U102596072A?off=vkfveas1', activo: false, precioEsElDelPlan: true });
    if (APLICAR) await prisma.setting.update({ where: { key: 'landing.enlacesDeVenta' }, data: { value: JSON.stringify(enlaces) } });
  } else paso('  = ya declarada');

  // 8. 2 % de Sara y total del corte
  paso('\n8. Corte del 31-oct');
  const lote = await prisma.payoutBatch.findUnique({ where: { code: CORTE } });
  const eq = await prisma.commission.findFirst({ where: { periodKey: 'EQUIPO-2026-10-31' } });
  // Misma ventana que comision-de-equipo.service: 16-oct 00:00 a 1-nov 00:00 de Bogotá.
  const agg = await prisma.incomeRecord.aggregate({
    where: { status: 'PAGADO', payerWhiteLabelId: null, whiteLabelId: 'dfd3cdff-7836-4aee-96a4-d7fa2b2907be', saleDate: { gte: new Date('2026-10-16T05:00:00Z'), lt: new Date('2026-11-01T05:00:00Z') } },
    _sum: { grossUsd: true },
  });
  const base = r2(Number(agg._sum.grossUsd ?? 0));
  const nuevo2 = r2((base * 2) / 100);
  paso(`  base de ventas ${APLICAR ? '' : '(ANTES de las correcciones, en ensayo) '}${base} → 2 % = ${nuevo2} (estaba ${eq?.amount} sobre ${eq?.baseAmountUsd})`);
  if (APLICAR && eq && eq.paymentStatus === 'PENDING' && Number(eq.amountPaid) === 0) {
    await prisma.commission.update({
      where: { id: eq.id },
      data: { amount: nuevo2, baseAmountUsd: base, notes: `Comisión de equipo: 2% de las ventas del 2026-10-16 al 2026-10-31 ($${base.toFixed(2)}, de Contabilidad).` },
    });
  }
  if (APLICAR) {
    const a = await prisma.commission.aggregate({ where: { payoutBatchId: lote.id, status: { not: 'REJECTED' } }, _sum: { amount: true } });
    const total = r2(Number(a._sum.amount ?? 0));
    await prisma.payoutBatch.update({ where: { id: lote.id }, data: { totalUsd: total } });
    paso(`  → total del corte ${lote.totalUsd} → ${total}`);
  }
  // Octubre completo en Contabilidad, para ver si sigue inflado.
  const oct = await prisma.incomeRecord.aggregate({
    where: { status: 'PAGADO', payerWhiteLabelId: null, whiteLabelId: 'dfd3cdff-7836-4aee-96a4-d7fa2b2907be', saleDate: { gte: new Date('2026-10-01T05:00:00Z'), lt: new Date('2026-11-01T05:00:00Z') } },
    _sum: { grossUsd: true }, _count: true,
  });
  paso(`  octubre en Contabilidad: USD ${r2(Number(oct._sum.grossUsd ?? 0))} en ${oct._count} cobros`);
})()
  .catch((e) => { console.error('ERROR', e.message); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
