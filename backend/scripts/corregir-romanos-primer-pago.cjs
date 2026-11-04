#!/usr/bin/env node
/**
 * ROMANOS BARBER SHOP & SPA: el pago manual de 68 es el PRIMER pago (2-oct),
 * no uno del 3-nov (Javier, 2026-11-04).
 *
 * Qué pasó: el negocio se dio de alta el 2-oct pagando 68 por fuera (a una
 * cuenta de Venezuela). Nadie lo apuntó hasta el 3-nov, cuando la contadora
 * asignó a Nicolás Quintero y registró el pago desde el panel. El panel lo
 * fechó HOY, así que quedaron:
 *   - la comisión del 2-oct (6,80), creada al asignar, sin ingreso que la
 *     respalde (la revisión diaria avisó «comisión sin ingreso»);
 *   - el ingreso de 68 en NOVIEMBRE, cuando es de octubre (el mes que paga la
 *     comisión del socio y la quincena del 2 % de Sara);
 *   - una segunda comisión de 6,80 del 3-nov, nacida de ese mismo pago.
 * La renovación (el segundo pago) va por Hotmart, con el link enviado al mismo
 * correo del dueño. A 2026-11-04 Hotmart aún no la ha cobrado.
 *
 * Qué hace:
 *   1. Pago manual e ingreso → fecha 2-oct, ciclo 2-oct a 2-nov, NUEVA.
 *   2. BORRA la comisión del 3-nov (pendiente, sin pagar, fuera de cortes).
 *      No basta con anularla: la comisión de una renovación de Hotmart nace con
 *      periodKey = mes del cobro, y la única (use, código, periodKey) la
 *      saltaría si ya hay una «2026-11», aunque esté anulada. Cuando Hotmart
 *      cobre, el webhook crea la de noviembre con su transacción y su fecha.
 *   3. El negocio vuelve a cobro por pasarela (manualPayment = false): sus
 *      renovaciones son por Hotmart. Con el modo manual encendido, antes del
 *      vencimiento le saldrían los datos para pagar por transferencia.
 *      NO se toca su vencimiento (3-dic): bajarlo al 2-nov lo dejaría vencido
 *      mientras paga el link. Cuando Hotmart cobre, el webhook pone la fecha
 *      que mande Hotmart.
 *
 * La comisión del socio de octubre y la del 2 % se recalculan solas cada hora
 * mientras no estén pagadas; el script dice cuáles ya lo están.
 *
 *   railway run --service backend --environment production \
 *     --project ba90d94d-7e6d-4056-85ad-0e3f24e8d43a \
 *     node scripts/corregir-romanos-primer-pago.cjs [--aplicar]
 *
 * Idempotente: cada paso comprueba que el dato sigue como se auditó.
 */
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const APLICAR = process.argv.includes('--aplicar');
const HOY = '2026-11-04';

const TENANT = '311a2bf1-096a-480e-b12e-7894a1006d42';
const PAGO = '9d57a570-028f-4049-9032-43daa7dd1f6d';
const COMISION_NOV = 'aa97db6a-5d26-42a2-a942-b3092a8794cb';
const COMISION_OCT = '11e16d1e-857f-4456-8503-99f5f615beaa';
/** Hora exacta del alta: la misma `businessDate` de la comisión de octubre. */
const ALTA = new Date('2026-10-02T16:47:15.579Z');
const FIN_CICLO = new Date('2026-11-02T16:47:15.579Z');
const NOTA = `[${HOY}] Primer pago (alta del 2-oct), registrado tarde el 3-nov. La renovación va por Hotmart (Javier).`;

const paso = (s) => console.log(s);
const iso = (d) => (d ? new Date(d).toISOString().slice(0, 16) : '—');

(async () => {
  console.log(APLICAR ? '=== APLICANDO ===' : '=== ENSAYO (sin --aplicar no se escribe nada) ===');
  const t = await prisma.tenant.findUnique({
    where: { id: TENANT },
    select: { brandName: true, manualPayment: true, currentPeriodEnd: true, lastChargeAt: true },
  });
  if (!t) throw new Error('No existe el negocio');
  paso(`Negocio: ${t.brandName} · manual=${t.manualPayment} · vence ${iso(t.currentPeriodEnd)}`);

  // Si Hotmart ya cobró, el cuadro cambia: no adivinar, parar.
  const hotmart = await prisma.incomeRecord.count({ where: { tenantId: TENANT, gateway: 'HOTMART' } });
  if (hotmart > 0) throw new Error('Ya hay un cobro de Hotmart de este negocio: revisar a mano antes de seguir.');

  paso('\n1. Pago manual e ingreso al 2-oct');
  const pago = await prisma.manualPayment.findUnique({ where: { id: PAGO } });
  if (!pago) paso('  ✗ el pago manual no existe — salto');
  else if (+pago.paidAt === +ALTA) paso('  = el pago ya está al 2-oct');
  else if (Number(pago.amount) !== 68 || pago.tenantId !== TENANT) paso(`  ✗ cambió (${pago.amount}, ${pago.tenantId}) — salto`);
  else {
    paso(`  → pago ${iso(pago.paidAt)} → ${iso(ALTA)}; ciclo ${iso(ALTA)} a ${iso(FIN_CICLO)}`);
    if (APLICAR) {
      await prisma.manualPayment.update({
        where: { id: PAGO },
        data: { paidAt: ALTA, periodStart: ALTA, periodEnd: FIN_CICLO, note: `${pago.note ? pago.note + '\n' : ''}${NOTA}` },
      });
    }
  }
  const ingreso = await prisma.incomeRecord.findFirst({ where: { externalTxId: PAGO } });
  if (!ingreso) paso('  ✗ el ingreso no existe — salto');
  else if (+ingreso.saleDate === +ALTA) paso('  = el ingreso ya está al 2-oct');
  else if (Number(ingreso.grossUsd) !== 68 || ingreso.status !== 'PAGADO') paso(`  ✗ el ingreso cambió (${ingreso.grossUsd} ${ingreso.status}) — salto`);
  else {
    paso(`  → ingreso ${iso(ingreso.saleDate)} ${ingreso.category} → ${iso(ALTA)} NUEVA (pasa de noviembre a octubre)`);
    if (APLICAR) {
      await prisma.incomeRecord.update({
        where: { id: ingreso.id },
        data: { saleDate: ALTA, category: 'NUEVA', note: `${ingreso.note ? ingreso.note + '\n' : ''}${NOTA}` },
      });
    }
  }

  paso('\n2. Comisión del 3-nov (la crea Hotmart cuando cobre)');
  const nov = await prisma.commission.findUnique({ where: { id: COMISION_NOV } });
  if (!nov) paso('  = ya no existe');
  else if (nov.paymentStatus !== 'PENDING' || Number(nov.amountPaid) > 0 || nov.payoutBatchId) {
    paso(`  ✗ ya está pagada o en un corte (${nov.status}/${nov.paymentStatus}, corte ${nov.payoutBatchId}) — NO se borra; avisar`);
  } else {
    paso(`  → borrar: ${JSON.stringify(nov)}`);
    if (APLICAR) await prisma.commission.delete({ where: { id: COMISION_NOV } });
  }
  const oct = await prisma.commission.findUnique({
    where: { id: COMISION_OCT },
    select: { amount: true, status: true, paymentStatus: true, payoutBatch: { select: { code: true, status: true } } },
  });
  paso(`  · la de octubre se queda: ${oct?.amount} ${oct?.status}/${oct?.paymentStatus} en ${oct?.payoutBatch?.code} (${oct?.payoutBatch?.status})`);

  paso('\n3. Renovaciones por Hotmart');
  if (t.manualPayment !== true) paso('  = ya no está en modo manual');
  else {
    paso(`  → manualPayment true → false (el vencimiento ${iso(t.currentPeriodEnd)} no se toca)`);
    if (APLICAR) {
      await prisma.tenant.update({ where: { id: TENANT }, data: { manualPayment: false } });
      await prisma.auditLog.create({
        data: {
          tenantId: TENANT,
          action: 'tenant.manual_payment_mode_changed',
          resource: `tenant:${TENANT}`,
          metadata: { from: true, to: false, brandName: t.brandName, motivo: NOTA },
        },
      });
    }
  }

  paso('\nLo que se recalcula solo (cron de cada hora, si no está pagado):');
  for (const pk of ['SOCIO-2026-10', 'EQUIPO-2026-10-15', 'EQUIPO-2026-11-15']) {
    const c = await prisma.commission.findFirst({ where: { periodKey: pk }, select: { amount: true, paymentStatus: true, amountPaid: true } });
    const pagada = c && (c.paymentStatus !== 'PENDING' || Number(c.amountPaid) > 0);
    paso(`  ${pk}: ${c ? c.amount : 'no existe'}${pagada ? ' — YA PAGADA: no cambia, la diferencia queda debida' : ''}`);
  }
})()
  .catch((e) => { console.error('ERROR', e.message); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
