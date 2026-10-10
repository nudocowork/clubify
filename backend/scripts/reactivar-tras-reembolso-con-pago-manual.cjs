/**
 * Un negocio pausado por un REEMBOLSO de Hotmart que paga de nuevo POR FUERA
 * (transferencia, etc.) por el MISMO período: se reactiva tal cual estaba y
 * pasa a «pago manual».
 *
 * Caso Drive Pizza (2026-10-09): el reembolso fue un error del cliente, que
 * pagó los USD 500 de su plan otra vez a mano. Hay que dejarlo como estaba,
 * cambiando solo el método de pago.
 *
 * POR QUÉ NO SIRVE «Registrar pago manual» del panel: ese botón asume un pago
 * NUEVO y encadena el ciclo desde el vencimiento actual — le regalaría otro
 * año entero. Aquí el pago manual REEMPLAZA al reembolsado: mismo período.
 *
 * Qué deshace (lo que hizo el aviso de reembolso, `hotmart.service`):
 *   - Negocio SUSPENDED → ACTIVE; borra suspendedAt y canceledAt.
 *     NO toca currentPeriodEnd, lastChargeAt ni la periodicidad.
 *   - Referido CHURNED → PAYING (vuelven a correr sus comisiones recurrentes).
 *   - Comisiones anuladas por ESE reembolso: solo con --reactivar-comisiones
 *     (pasan a PENDING conservando la nota, que es la marca que evita que el
 *     conciliador las vuelva a anular — ver `fueReactivada`).
 * Qué añade:
 *   - manualPayment = true; desvincula los identificadores de Hotmart (se
 *     guardan en la nota del pago) para que un aviso tardío de esa suscripción
 *     no lo vuelva a pausar.
 *   - Fila ManualPayment por el MISMO período (lastChargeAt → currentPeriodEnd).
 *   - Ingreso MANUAL por el monto (el de Hotmart sigue REEMBOLSADO: ese dinero
 *     se devolvió).
 *
 *   railway run --service Postgres-Nq8w node scripts/reactivar-tras-reembolso-con-pago-manual.cjs \
 *     --negocio drive-pizza --monto 500 --pagado 2026-10-09 --metodo TRANSFERENCIA [--reactivar-comisiones] [--aplicar]
 */
const { PrismaClient } = require('@prisma/client');
const { randomUUID } = require('crypto');

const arg = (n) => {
  const i = process.argv.indexOf(`--${n}`);
  return i > -1 ? process.argv[i + 1] : undefined;
};
const APLICAR = process.argv.includes('--aplicar');
const REACTIVAR_COMISIONES = process.argv.includes('--reactivar-comisiones');
const slug = arg('negocio');
const monto = Number(arg('monto'));
const pagadoTxt = arg('pagado');
const metodo = String(arg('metodo') || 'TRANSFERENCIA').toUpperCase();
if (!slug || !(monto > 0) || !/^\d{4}-\d{2}-\d{2}$/.test(pagadoTxt || '')) {
  console.error('Uso: --negocio <slug> --monto <USD> --pagado AAAA-MM-DD [--metodo TRANSFERENCIA|NEQUI|EFECTIVO|OTRO] [--reactivar-comisiones] [--aplicar]');
  process.exit(1);
}
if (!['NEQUI', 'EFECTIVO', 'TRANSFERENCIA', 'OTRO'].includes(metodo)) {
  console.error('Método no válido.');
  process.exit(1);
}
// Mediodía de Bogotá: el día escrito, sin que la zona lo corra al anterior.
const pagado = new Date(`${pagadoTxt}T17:00:00.000Z`);
const MARCA = 'Hotmart devolvió el pago';
const f = (d) => (d ? new Date(d).toISOString().slice(0, 10) : '—');

const p = new PrismaClient({
  datasources: { db: { url: process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL } },
});

(async () => {
  const t = await p.tenant.findFirst({
    where: { slug, deletedAt: null },
    select: {
      id: true, brandName: true, status: true, suspendedAt: true, canceledAt: true,
      currentPeriodEnd: true, lastChargeAt: true, planPeriodicity: true, manualPayment: true,
      hotmartSubscriberCode: true, hotmartTransactionId: true, whiteLabelId: true, creditReleasedAt: true,
    },
  });
  if (!t) throw new Error(`No existe el negocio «${slug}».`);

  console.log(`\n${t.brandName} (${slug})`);
  console.log(`  estado ${t.status} · suspendido ${f(t.suspendedAt)} · cancelado ${f(t.canceledAt)}`);
  console.log(`  plan ${t.planPeriodicity ?? '—'} · último cobro ${f(t.lastChargeAt)} · vence ${f(t.currentPeriodEnd)}`);
  console.log(`  pago manual: ${t.manualPayment} · Hotmart subscriber ${t.hotmartSubscriberCode ?? '—'} · tx ${t.hotmartTransactionId ?? '—'}`);

  if (!t.currentPeriodEnd) throw new Error('El negocio no tiene vencimiento (currentPeriodEnd): revisar a mano.');
  if (t.currentPeriodEnd.getTime() < Date.now()) {
    console.log('  ⚠ Su vencimiento YA PASÓ: reactivarlo así lo dejaría vencido. Revisar a mano antes de aplicar.');
  }

  const ingresos = await p.incomeRecord.findMany({
    where: { tenantId: t.id },
    orderBy: { saleDate: 'desc' },
    take: 6,
    select: { id: true, gateway: true, externalTxId: true, grossUsd: true, saleDate: true, status: true, refundedAt: true, category: true, planPeriodicity: true, productName: true, isFirstPayment: true },
  });
  console.log('\n  Últimos ingresos:');
  for (const i of ingresos) {
    console.log(`    ${f(i.saleDate)} ${i.gateway} ${i.externalTxId} $${Number(i.grossUsd)} ${i.status}${i.refundedAt ? ` (devuelto ${f(i.refundedAt)})` : ''}`);
  }
  const reembolsado = ingresos.find((i) => i.status === 'REEMBOLSADO');
  if (!reembolsado) console.log('  ⚠ No hay ningún ingreso REEMBOLSADO: ¿seguro que es este caso?');

  const usos = await p.referralUse.findMany({ where: { tenantId: t.id }, select: { id: true, status: true } });
  console.log(`\n  Referido: ${usos.length ? usos.map((u) => u.status).join(', ') : 'ninguno'}`);
  const comisiones = usos.length
    ? await p.commission.findMany({
        where: { referralUseId: { in: usos.map((u) => u.id) }, status: 'REJECTED', notes: { contains: MARCA } },
        select: { id: true, amount: true, currency: true, notes: true, businessDate: true },
      })
    : [];
  console.log(`  Comisiones anuladas por el reembolso: ${comisiones.length}`);
  for (const c of comisiones) console.log(`    ${c.id} $${Number(c.amount)} ${c.currency ?? ''} (cobro ${f(c.businessDate)})`);

  const inicio = t.lastChargeAt ?? null;
  if (!inicio) throw new Error('Sin lastChargeAt no sé desde cuándo cubre el pago: revisar a mano.');
  console.log(`\n  ${APLICAR ? 'APLICO' : 'Simulo'}:`);
  console.log(`    - ${t.status} → ACTIVE; suspendido/cancelado → vacío; vence ${f(t.currentPeriodEnd)} SIN CAMBIO`);
  console.log(`    - pago manual ${metodo} $${monto} el ${pagadoTxt}, cubre ${f(inicio)} → ${f(t.currentPeriodEnd)}`);
  console.log(`    - ingreso MANUAL $${monto} (${pagadoTxt}); el de Hotmart sigue REEMBOLSADO`);
  console.log(`    - Hotmart desvinculado (queda anotado en el pago)`);
  console.log(`    - referido → PAYING`);
  console.log(`    - comisiones: ${REACTIVAR_COMISIONES ? `${comisiones.length} → PENDING` : 'sin tocar (añade --reactivar-comisiones)'}`);
  if (t.whiteLabelId && t.creditReleasedAt) {
    console.log('  ⚠ Es de marca blanca y se le liberó el crédito al pausarlo: revisar si hay que cobrárselo otra vez.');
  }
  if (!APLICAR) {
    console.log('\n(simulación: añade --aplicar para escribir)');
    return p.$disconnect();
  }

  const idPago = randomUUID();
  const nota =
    `Reemplaza el cobro de Hotmart reembolsado por error (${reembolsado?.externalTxId ?? 'sin tx'}). ` +
    `Hotmart antes: subscriber ${t.hotmartSubscriberCode ?? '—'}, tx ${t.hotmartTransactionId ?? '—'}. ` +
    `Registrado con reactivar-tras-reembolso-con-pago-manual.cjs.`;
  const mesContable = `${pagado.getUTCFullYear()}-${String(pagado.getUTCMonth() + 1).padStart(2, '0')}`;

  await p.$transaction(async (tx) => {
    // Con guarda: si alguien lo reactivó mientras tanto, no se pisa nada.
    const n = await tx.tenant.updateMany({
      where: { id: t.id, status: t.status },
      data: {
        status: 'ACTIVE',
        suspendedAt: null,
        canceledAt: null,
        manualPayment: true,
        hotmartSubscriberCode: null,
        hotmartTransactionId: null,
        failedPaymentCount: 0,
      },
    });
    if (n.count !== 1) throw new Error('El negocio cambió mientras tanto: no se aplicó nada.');
    await tx.manualPayment.create({
      data: {
        id: idPago, tenantId: t.id, whiteLabelId: t.whiteLabelId, method: metodo,
        amount: monto, currency: 'USD', reference: null, note: nota,
        paidAt: pagado, periodStart: inicio, periodEnd: t.currentPeriodEnd, periodicity: t.planPeriodicity,
      },
    });
    await tx.incomeRecord.create({
      data: {
        gateway: 'MANUAL', externalTxId: idPago, tenantId: t.id, whiteLabelId: t.whiteLabelId,
        brandName: t.brandName, productName: reembolsado?.productName ?? null,
        planPeriodicity: t.planPeriodicity, category: reembolsado?.category ?? null,
        currency: 'USD', grossUsd: monto, gatewayFeeUsd: 0, taxUsd: 0, otherDiscountUsd: 0,
        netExpectedUsd: monto, isFirstPayment: reembolsado?.isFirstPayment ?? false,
        periodKey: mesContable, saleDate: pagado, status: 'PAGADO', note: nota.slice(0, 1000),
      },
    });
    if (usos.length) {
      await tx.referralUse.updateMany({ where: { tenantId: t.id, status: 'CHURNED' }, data: { status: 'PAYING' } });
    }
    if (REACTIVAR_COMISIONES && comisiones.length) {
      await tx.commission.updateMany({
        where: { id: { in: comisiones.map((c) => c.id) }, status: 'REJECTED' },
        data: { status: 'PENDING' },
      });
    }
  });
  console.log(`\n✓ ${t.brandName} activo, en pago manual, vence ${f(t.currentPeriodEnd)}. Pago ${idPago}.`);
  console.log('  Revisa en el panel: estado, Contabilidad (ingreso MANUAL) y, si reactivaste, las comisiones.');
  await p.$disconnect();
})().catch(async (e) => {
  console.error('ERROR:', e.message);
  await p.$disconnect();
  process.exit(1);
});
