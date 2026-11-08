/**
 * Pasa un negocio de Hotmart a PAGO POR FUERA y lo activa, CONSERVANDO su fecha
 * de cobro.
 *
 * Por qué no basta con «Registrar pago manual» del panel: ese botón arranca el
 * ciclo en la FECHA DE PAGO (`manual-payment-period.ts`). Si el cliente pagaba
 * el 15 de cada mes y paga por fuera el 7, el panel le movería el cobro al 7 y
 * todos los avisos con él. Aquí el ciclo sigue anclado al vencimiento que ya
 * tenía: se avanza desde `currentPeriodEnd`, un período cada vez, hasta dejarlo
 * en el futuro.
 *
 * No toca el plan ni la periodicidad. No borra `hotmartSubscriberCode`: es
 * historia, y el webhook de Hotmart ya ignora atrasos y cancelaciones de un
 * negocio con `manualPayment` (hotmart.service.ts, `runEventLogic`).
 *
 * Por defecto SOLO muestra lo que haría. Escribe con --aplicar.
 *
 * Uso:
 *   railway run --service backend --environment production --project ba90d94d-7e6d-4056-85ad-0e3f24e8d43a \
 *     node scripts/pasar-a-pago-por-fuera.cjs motilart [--monto=68] [--metodo=TRANSFERENCIA] \
 *     [--fecha=2026-11-07] [--referencia=...] [--aplicar]
 *
 * --monto va en USD (Contabilidad es en dólares; el conciliador nocturno lo
 * lleva al libro). Sin monto el ciclo queda cubierto pero no suma ingreso.
 */
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient({
  datasources: { db: { url: process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL } },
});

const args = process.argv.slice(2);
const busca = args.find((a) => !a.startsWith('--'));
const opt = (k) => (args.find((a) => a.startsWith(`--${k}=`)) || '').split('=').slice(1).join('=') || null;
const APLICAR = args.includes('--aplicar');
const METODOS = ['NEQUI', 'EFECTIVO', 'TRANSFERENCIA', 'OTRO'];

// Copia de common/plan-period.ts (addPlanPeriod): meses reales, día acotado
// al último del mes destino. 31-ene + 1 mes = 28-feb, no 3-mar.
function meses(per) {
  const u = String(per || '').toUpperCase();
  if (/SEMESTRAL|SEMIANUAL/.test(u)) return 6;
  if (/TRIMESTRAL/.test(u)) return 3;
  if (/ANUAL/.test(u)) return 12;
  return 1;
}
function sumarPeriodo(desde, per) {
  const d = new Date(desde);
  const dia = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + meses(per));
  d.setDate(Math.min(dia, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()));
  return d;
}
const f = (d) => (d ? new Date(d).toISOString().slice(0, 10) : '—');

(async () => {
  if (!busca) throw new Error('Falta el nombre o slug del negocio (ej. motilart).');
  const metodo = (opt('metodo') || 'TRANSFERENCIA').toUpperCase();
  if (!METODOS.includes(metodo)) throw new Error(`--metodo debe ser uno de ${METODOS.join(', ')}`);
  const monto = opt('monto') != null ? Number(opt('monto')) : null;
  if (monto != null && !(monto >= 0)) throw new Error('--monto inválido');
  const ahora = new Date();
  const pagadoEl = opt('fecha') ? new Date(`${opt('fecha')}T12:00:00-05:00`) : ahora;
  if (Number.isNaN(pagadoEl.getTime()) || pagadoEl.getTime() > ahora.getTime() + 864e5) {
    throw new Error('--fecha inválida o futura');
  }

  const candidatos = await p.tenant.findMany({
    where: {
      deletedAt: null,
      OR: [
        { brandName: { contains: busca, mode: 'insensitive' } },
        { slug: { contains: busca, mode: 'insensitive' } },
      ],
    },
    select: {
      id: true, slug: true, brandName: true, status: true, whiteLabelId: true,
      planPeriodicity: true, plan: { select: { name: true } },
      manualPayment: true, hotmartSubscriberCode: true,
      currentPeriodEnd: true, lastChargeAt: true, trialEndsAt: true,
      canceledAt: true, suspendedAt: true, failedPaymentCount: true, firstFailedAt: true,
      notes: true,
    },
  });
  if (candidatos.length !== 1) {
    console.log(`Se esperaba 1 negocio para «${busca}» y hay ${candidatos.length}:`);
    for (const c of candidatos) console.log(` - ${c.brandName} (${c.slug}) ${c.id} ${c.status}`);
    throw new Error('Afina la búsqueda (usa el slug exacto).');
  }
  const t = candidatos[0];
  console.log('ANTES', JSON.stringify({ ...t, notes: undefined, plan: t.plan?.name }, null, 2));

  if (!t.currentPeriodEnd) {
    throw new Error('El negocio no tiene fecha de cobro (currentPeriodEnd): no hay fecha que conservar. Regístralo desde el panel.');
  }
  if (t.whiteLabelId) {
    console.log('OJO: es de una marca blanca. Este script no cobra el crédito de marca de la activación.');
  }

  // El ciclo que acaba de pagar: el que vencía y no cobró Hotmart. Se avanza
  // desde el vencimiento viejo, nunca desde la fecha de pago.
  let inicio = null;
  let fin = new Date(t.currentPeriodEnd);
  while (fin.getTime() <= ahora.getTime()) {
    inicio = fin;
    fin = sumarPeriodo(fin, t.planPeriodicity);
  }
  const cambiaFecha = fin.getTime() !== new Date(t.currentPeriodEnd).getTime();

  const nota = `${f(ahora)}: pasa de Hotmart a pago por fuera (${metodo}${monto != null ? `, ${monto} USD` : ''}). Fecha de cobro conservada: próximo ${f(fin)}.`;
  console.log('\nPLAN');
  console.log(` - manualPayment: ${t.manualPayment} → true`);
  console.log(` - status: ${t.status} → ACTIVE${t.canceledAt ? ' (y se quita la cancelación de Hotmart)' : ''}`);
  console.log(` - próximo cobro: ${f(t.currentPeriodEnd)} → ${f(fin)}${cambiaFecha ? '' : ' (sin cambio)'}`);
  console.log(` - plan y periodicidad: ${t.plan?.name} / ${t.planPeriodicity} (sin cambio)`);
  console.log(inicio
    ? ` - pago por fuera ${metodo} del ${f(pagadoEl)} que cubre ${f(inicio)} → ${f(fin)}`
    : ' - el ciclo actual sigue cubierto hasta esa fecha: no se registra pago nuevo');
  console.log(` - nota interna: «${nota}»`);

  if (inicio) {
    const DIA = 864e5;
    const repetido = await p.manualPayment.findFirst({
      where: { tenantId: t.id, periodStart: { gte: new Date(inicio.getTime() - DIA), lte: new Date(inicio.getTime() + DIA) } },
      select: { id: true, paidAt: true },
    });
    if (repetido) throw new Error(`Ya hay un pago por fuera para ese ciclo (${repetido.id}, ${f(repetido.paidAt)}). No se toca nada.`);
  }

  if (!APLICAR) {
    console.log('\nSimulación: no se escribió nada. Repite con --aplicar.');
    return;
  }

  const ops = [];
  if (inicio) {
    ops.push(p.manualPayment.create({
      data: {
        tenantId: t.id, whiteLabelId: t.whiteLabelId, method: metodo,
        amount: monto, currency: monto != null ? 'USD' : null,
        reference: opt('referencia'), note: 'Pasa de Hotmart a pago por fuera; ciclo anclado a su fecha de cobro.',
        paidAt: pagadoEl, periodStart: inicio, periodEnd: fin,
        periodicity: String(t.planPeriodicity || 'MENSUAL').toUpperCase(),
        actorId: null,
      },
    }));
  }
  ops.push(p.tenant.update({
    where: { id: t.id },
    data: {
      manualPayment: true,
      status: 'ACTIVE',
      suspendedAt: null,
      canceledAt: null,
      trialEndsAt: null,
      currentPeriodEnd: fin,
      ...(inicio ? { lastChargeAt: pagadoEl } : {}),
      failedPaymentCount: 0,
      firstFailedAt: null,
      // Sin limpiar estas marcas el negocio no recibe ningún aviso del ciclo
      // nuevo: los crons las comparan con currentPeriodEnd. Mismo reset que
      // registerManualPayment y que una renovación real de Hotmart.
      ...(cambiaFecha ? { preReminder7dSentFor: null, preReminder3dSentFor: null, preReminderTodaySentFor: null, paymentReminderSentFor: null } : {}),
      paymentFailureNoticeSentAt: null,
      pausePendingNoticeSentAt: null,
      graceNoticeSentAt: null,
      creditReleasedAt: null,
      notes: t.notes ? `${t.notes}\n${nota}` : nota,
    },
    select: { id: true, status: true, manualPayment: true, currentPeriodEnd: true, lastChargeAt: true, planPeriodicity: true },
  }));
  const r = await p.$transaction(ops);
  console.log('\nDESPUÉS', JSON.stringify(r[r.length - 1], null, 2));
  console.log('Listo. El panel lo verá activo en ≤30 s (caché del estado).');
})()
  .catch((e) => { console.error('ERROR:', e.message); process.exitCode = 1; })
  .finally(() => p.$disconnect());
