/**
 * Deshace lo que «Asignar a negocio» le hizo a un negocio al asignarle un pago
 * VIEJO, y lo deja SUSPENDIDO.
 *
 * Caso DINOROLLS (Javier, 2026-11-09): se le asignó el pago de su primera
 * suscripción, de hace meses; el negocio había decidido no renovar y su plan
 * venció en octubre, pero al asignar quedó activo. Desde este arreglo un pago
 * así se registra como historial sin activar (`modoDeLaAsignacion`); este
 * script limpia lo que ya pasó.
 *
 * Qué hace, a partir de la foto «before» que guardó la asignación en AuditLog:
 *  - vuelve a poner la fecha de cobro, el último cobro y los identificadores
 *    de la pasarela que tenía;
 *  - lo deja SUSPENDED (no renovó: es lo que habría hecho el cron al vencer);
 *  - rechaza las comisiones que nacieron con la asignación y siguen sin pagar
 *    (lo pagado no se retracta);
 *  - el pago sigue fuera de «Pagos sin activar» y su ingreso sigue a nombre del
 *    negocio: es un pago real suyo, solo que viejo.
 *
 * Por defecto SOLO muestra lo que haría. Escribe con --aplicar.
 *
 *   railway run --service backend --environment production --project ba90d94d-7e6d-4056-85ad-0e3f24e8d43a \
 *     node scripts/revertir-asignacion-de-pago.cjs dinorolls [--aplicar]
 */
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient({
  datasources: { db: { url: process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL } },
});

const args = process.argv.slice(2);
const busca = args.find((a) => !a.startsWith('--'));
const APLICAR = args.includes('--aplicar');
const f = (d) => (d ? new Date(d).toISOString().slice(0, 10) : '—');
const fecha = (v) => (v ? new Date(v) : null);

(async () => {
  if (!busca) throw new Error('Falta el nombre o slug del negocio (ej. dinorolls).');
  const candidatos = await p.tenant.findMany({
    where: {
      deletedAt: null,
      OR: [
        { brandName: { contains: busca, mode: 'insensitive' } },
        { slug: { contains: busca, mode: 'insensitive' } },
      ],
    },
    select: {
      id: true, slug: true, brandName: true, status: true, suspendedAt: true,
      currentPeriodEnd: true, lastChargeAt: true, planPeriodicity: true,
      hotmartSubscriberCode: true, hotmartTransactionId: true,
      stripeCustomerId: true, stripeSubscriptionId: true,
    },
  });
  if (candidatos.length !== 1) {
    console.log(`Se esperaba 1 negocio para «${busca}» y hay ${candidatos.length}:`);
    for (const c of candidatos) console.log(` - ${c.brandName} (${c.slug}) ${c.id} ${c.status}`);
    throw new Error('Afina la búsqueda (usa el slug exacto).');
  }
  const t = candidatos[0];

  const audit = await p.auditLog.findFirst({
    where: { tenantId: t.id, action: 'pending_payment.assigned_to_tenant' },
    orderBy: { createdAt: 'desc' },
  });
  if (!audit) throw new Error(`${t.brandName} no tiene ninguna asignación de pago registrada.`);
  const before = audit.metadata?.before ?? {};

  console.log(`NEGOCIO ${t.brandName} (${t.slug}) ${t.id}`);
  console.log(`Asignación del ${audit.createdAt.toISOString()} · pago de ${audit.metadata?.paymentEmail ?? '—'}`);
  console.log('\n                   ANTES DE ASIGNAR   HOY            →  QUEDA');
  console.log(` estado             ${String(before.status ?? '—').padEnd(17)}  ${t.status.padEnd(13)}  →  SUSPENDED`);
  console.log(` próximo cobro      ${f(before.currentPeriodEnd).padEnd(17)}  ${f(t.currentPeriodEnd).padEnd(13)}  →  ${f(before.currentPeriodEnd)}`);
  console.log(` último cobro       ${f(before.lastChargeAt).padEnd(17)}  ${f(t.lastChargeAt).padEnd(13)}  →  ${f(before.lastChargeAt)}`);
  console.log(` código Hotmart     ${String(before.hotmartSubscriberCode ?? '—').padEnd(17)}  ${String(t.hotmartSubscriberCode ?? '—').padEnd(13)}  →  ${before.hotmartSubscriberCode ?? '—'}`);

  // Comisiones nacidas con la asignación (se generan justo después, en el
  // mismo minuto). Solo las que nadie ha pagado.
  const desde = new Date(audit.createdAt.getTime() - 60_000);
  const comisiones = await p.commission.findMany({
    where: { referralUse: { tenantId: t.id }, createdAt: { gte: desde } },
    select: { id: true, amount: true, amountPaid: true, status: true, periodKey: true, createdAt: true },
  });
  const aRechazar = comisiones.filter(
    (c) => ['PENDING', 'APPROVED'].includes(c.status) && Number(c.amountPaid) === 0,
  );
  console.log(`\nComisiones creadas desde la asignación: ${comisiones.length}`);
  for (const c of comisiones) {
    const toca = aRechazar.includes(c);
    console.log(`  ${c.id} · $${c.amount} · ${c.status} · ${c.periodKey ?? '—'} · ${toca ? '→ REJECTED' : 'se queda (ya pagada o no pendiente)'}`);
  }

  if (!APLICAR) {
    console.log('\nSimulación: no se escribió nada. Repite con --aplicar.');
    return;
  }

  const ahora = new Date();
  const nota = `${f(ahora)}: se deshace la asignación del pago viejo del ${f(audit.createdAt)} (no renovó). Suspendido.`;
  await p.$transaction([
    p.tenant.update({
      where: { id: t.id },
      data: {
        status: 'SUSPENDED',
        suspendedAt: t.suspendedAt ?? ahora,
        currentPeriodEnd: fecha(before.currentPeriodEnd),
        lastChargeAt: fecha(before.lastChargeAt),
        hotmartSubscriberCode: before.hotmartSubscriberCode ?? null,
        hotmartTransactionId: before.hotmartTransactionId ?? null,
        stripeCustomerId: before.stripeCustomerId ?? null,
        stripeSubscriptionId: before.stripeSubscriptionId ?? null,
      },
    }),
    ...aRechazar.map((c) =>
      p.commission.update({
        where: { id: c.id },
        data: { status: 'REJECTED', notes: 'Rechazada: nació al asignar un pago viejo a un negocio que no renovó (2026-11-09).' },
      }),
    ),
    p.auditLog.create({
      data: {
        actorId: null,
        tenantId: t.id,
        action: 'pending_payment.assignment_reverted',
        resource: audit.resource,
        metadata: { revierte: audit.id, before, comisionesRechazadas: aRechazar.map((c) => c.id), nota },
      },
    }),
  ]);
  console.log(`\nListo. ${t.brandName} queda SUSPENDED; ${aRechazar.length} comisión(es) rechazada(s).`);
  console.log('El panel lo verá en ≤30 s (caché del estado).');
})()
  .catch((e) => { console.error('ERROR:', e.message); process.exitCode = 1; })
  .finally(() => p.$disconnect());
