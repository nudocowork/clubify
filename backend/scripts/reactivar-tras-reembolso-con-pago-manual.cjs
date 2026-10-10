/**
 * Un negocio pausado por un REEMBOLSO de Hotmart que paga de nuevo POR FUERA
 * por el MISMO período: queda como si SIEMPRE hubiera sido de pago manual.
 *
 * Caso Drive Pizza (2026-10-09): el reembolso fue un error del cliente, que
 * pagó los USD 500 de su plan otra vez a mano. Javier: «hacer como que siempre
 * fuera manual desde el inicio, las comisiones igual y todo igual como desde
 * el día que pagó». Por eso el pago manual y su ingreso llevan la FECHA Y EL
 * MONTO DEL COBRO ORIGINAL, no los de hoy, y las comisiones vuelven a la vida.
 *
 * POR QUÉ NO SIRVE «Registrar pago manual» del panel: asume un pago NUEVO y
 * encadena el ciclo desde el vencimiento actual — le regalaría otro año.
 *
 * POR QUÉ el ingreso de Hotmart se queda REEMBOLSADO y se añade uno MANUAL (y
 * no se «convierte» el de Hotmart): el conciliador nocturno repasa los avisos
 * de Hotmart. Si la fila de esa transacción dejara de ser HOTMART, la vería
 * como un cobro que falta en el libro y la CREARÍA otra vez (USD 500 dobles);
 * si se dejara HOTMART en PAGADO, la volvería a marcar REEMBOLSADO cada noche.
 * Así el mes del cobro suma lo mismo que antes y nada lo deshace.
 *
 * Qué deshace (lo que hizo el aviso de reembolso, `hotmart.service`):
 *   - Negocio SUSPENDED → ACTIVE; borra suspendedAt y canceledAt.
 *     NO toca currentPeriodEnd, lastChargeAt ni la periodicidad.
 *   - Referido CHURNED → PAYING.
 *   - Comisiones anuladas por ese reembolso → PENDING (el corte las aprueba
 *     al llegar su fecha). Conservan la nota con la marca del reembolso: es lo
 *     que hace que el conciliador NO las vuelva a anular (`fueReactivada`).
 * Qué añade:
 *   - manualPayment = true; desvincula los identificadores de Hotmart (quedan
 *     en la nota del pago) para que un aviso tardío no lo vuelva a pausar.
 *   - Fila ManualPayment con la fecha del cobro original, mismo período.
 *   - Ingreso MANUAL por el mismo monto, fecha y mes contable que el original.
 *
 *   railway run --service Postgres-Nq8w node scripts/reactivar-tras-reembolso-con-pago-manual.cjs \
 *     --negocio drive-pizza [--metodo TRANSFERENCIA] [--sin-comisiones] [--aplicar]
 */
const { PrismaClient } = require('@prisma/client');
const { randomUUID } = require('crypto');

const arg = (n) => {
  const i = process.argv.indexOf(`--${n}`);
  return i > -1 ? process.argv[i + 1] : undefined;
};
const APLICAR = process.argv.includes('--aplicar');
// «Las comisiones igual»: vuelven siempre, salvo que se pida lo contrario.
const REACTIVAR_COMISIONES = !process.argv.includes('--sin-comisiones');
const slug = arg('negocio');
const metodo = String(arg('metodo') || 'TRANSFERENCIA').toUpperCase();
if (!slug) {
  console.error('Uso: --negocio <slug> [--metodo TRANSFERENCIA|NEQUI|EFECTIVO|OTRO] [--sin-comisiones] [--aplicar]');
  process.exit(1);
}
if (!['NEQUI', 'EFECTIVO', 'TRANSFERENCIA', 'OTRO'].includes(metodo)) {
  console.error('Método no válido.');
  process.exit(1);
}
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
    select: {
      id: true, gateway: true, externalTxId: true, grossUsd: true, saleDate: true, status: true,
      refundedAt: true, category: true, productName: true, isFirstPayment: true, periodKey: true,
    },
  });
  console.log('\n  Últimos ingresos:');
  for (const i of ingresos) {
    console.log(`    ${f(i.saleDate)} ${i.gateway} ${i.externalTxId} $${Number(i.grossUsd)} ${i.status}${i.refundedAt ? ` (devuelto ${f(i.refundedAt)})` : ''}`);
  }
  const reembolsado = ingresos.find((i) => i.status === 'REEMBOLSADO' && i.gateway === 'HOTMART');
  if (!reembolsado) {
    throw new Error('No hay ningún cobro de Hotmart REEMBOLSADO en este negocio: no es este caso, no se toca nada.');
  }
  // «Todo igual como desde el día que pagó»: mandan la fecha y el monto del
  // cobro original.
  const pagado = reembolsado.saleDate;
  const monto = Number(reembolsado.grossUsd);

  const usos = await p.referralUse.findMany({ where: { tenantId: t.id }, select: { id: true, status: true } });
  console.log(`\n  Referido: ${usos.length ? usos.map((u) => u.status).join(', ') : 'ninguno'}`);
  const comisiones = usos.length
    ? await p.commission.findMany({
        where: { referralUseId: { in: usos.map((u) => u.id) }, status: 'REJECTED', notes: { contains: MARCA } },
        select: { id: true, amount: true, currency: true, businessDate: true },
      })
    : [];
  console.log(`  Comisiones anuladas por el reembolso: ${comisiones.length}`);
  for (const c of comisiones) console.log(`    ${c.id} $${Number(c.amount)} ${c.currency ?? ''} (cobro ${f(c.businessDate)})`);

  const inicio = t.lastChargeAt ?? pagado;
  const periodoContable = reembolsado.periodKey
    || `${pagado.getUTCFullYear()}-${String(pagado.getUTCMonth() + 1).padStart(2, '0')}`;

  console.log(`\n  ${APLICAR ? 'APLICO' : 'Simulo'}:`);
  console.log(`    - ${t.status} → ACTIVE; suspendido y cancelado → vacío; vence ${f(t.currentPeriodEnd)} SIN CAMBIO`);
  console.log(`    - pago manual ${metodo} $${monto} con la fecha ORIGINAL ${f(pagado)}, cubre ${f(inicio)} → ${f(t.currentPeriodEnd)}`);
  console.log(`    - ingreso MANUAL $${monto} el ${f(pagado)} (mes ${periodoContable}); el de Hotmart queda REEMBOLSADO`);
  console.log(`    - Hotmart desvinculado (queda anotado en el pago)`);
  console.log(`    - referido → PAYING`);
  console.log(`    - comisiones: ${REACTIVAR_COMISIONES ? `${comisiones.length} vuelven (PENDING; el corte las aprueba al llegar su fecha)` : 'sin tocar'}`);
  if (t.whiteLabelId && t.creditReleasedAt) {
    console.log('  ⚠ Es de marca blanca y se le liberó el crédito al pausarlo: revisar si hay que cobrárselo otra vez.');
  }
  if (!APLICAR) {
    console.log('\n(simulación: añade --aplicar para escribir)');
    return p.$disconnect();
  }

  const idPago = randomUUID();
  const nota =
    `Siempre fue de pago manual: reemplaza el cobro de Hotmart ${reembolsado.externalTxId}, reembolsado por error. ` +
    `Hotmart antes: subscriber ${t.hotmartSubscriberCode ?? '—'}, tx ${t.hotmartTransactionId ?? '—'}. ` +
    `Registrado con reactivar-tras-reembolso-con-pago-manual.cjs.`;

  await p.$transaction(async (tx) => {
    // Con guarda: si alguien lo tocó mientras tanto, no se pisa nada.
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
        brandName: t.brandName, productName: reembolsado.productName ?? null,
        planPeriodicity: t.planPeriodicity, category: reembolsado.category ?? null,
        currency: 'USD', grossUsd: monto, gatewayFeeUsd: 0, taxUsd: 0, otherDiscountUsd: 0,
        netExpectedUsd: monto, isFirstPayment: reembolsado.isFirstPayment ?? false,
        periodKey: periodoContable, saleDate: pagado, status: 'PAGADO', note: nota.slice(0, 1000),
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
  console.log(`\n✓ ${t.brandName} activo, en pago manual desde el ${f(pagado)}, vence ${f(t.currentPeriodEnd)}. Pago ${idPago}.`);
  console.log('  Revisa en el panel: estado, Contabilidad (ingreso MANUAL) y las comisiones.');
  await p.$disconnect();
})().catch(async (e) => {
  console.error('ERROR:', e.message);
  await p.$disconnect();
  process.exit(1);
});
