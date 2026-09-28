/**
 * Devuelve a ACTIVE la cuenta SELLEA (`prueba-selleala`).
 *
 * POR QUÉ SE SUSPENDIÓ: el 26 de septiembre llegó una cancelación de Stripe y
 * `onSubscriptionCancelled` la suspendió en el acto, sin mirar que tenía pagado
 * hasta el 26 de OCTUBRE. Esa puerta era la única de las tres que no aplicaba
 * `desconectaAlCancelar` — el botón del panel y Hotmart sí—. Arreglado en el
 * código; este script repara el daño que ya estaba hecho.
 *
 * Además la cuenta vive del CRÉDITO DE MARCA (`wl-…`) y no tiene precio de
 * suscripción, así que no le paga nada a ninguna pasarela: una cancelación en
 * Stripe no debería poder tumbarla nunca.
 *
 * TOCA UNA SOLA FILA Y DOS CAMPOS: `status` y `suspendedAt`. No se inventan
 * fechas de cobro, no se toca `currentPeriodEnd` (sigue en el 26 de octubre) ni
 * nada de la pasarela. Deja rastro en `AuditLog` para que mañana se pueda saber
 * quién la volvió a encender y por qué.
 *
 * Idempotente: si ya está ACTIVE no hace nada.
 *
 * Uso:  railway run node scripts/reactivar-sellea.cjs
 */
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient({
  datasources: {
    db: { url: process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL },
  },
});

const SLUG = 'prueba-selleala';

(async () => {
  const antes = await p.tenant.findFirst({
    where: { slug: SLUG },
    select: {
      id: true,
      brandName: true,
      status: true,
      suspendedAt: true,
      currentPeriodEnd: true,
      hotmartSubscriberCode: true,
      subscriptionPriceUsd: true,
    },
  });
  if (!antes) {
    console.log(`No existe ningún negocio con slug "${SLUG}".`);
    return p.$disconnect();
  }

  console.log('=== ANTES ===');
  console.log('  negocio        :', antes.brandName);
  console.log('  estado         :', antes.status);
  console.log('  suspendida el  :', antes.suspendedAt?.toISOString() ?? '—');
  console.log('  fin de periodo :', antes.currentPeriodEnd?.toISOString() ?? '—');
  console.log('  precio         :', antes.subscriptionPriceUsd ?? '— (sin precio: no paga)');

  if (antes.status === 'ACTIVE') {
    console.log('\nYa está ACTIVE. No hay nada que hacer.');
    return p.$disconnect();
  }

  // El `where` lleva el estado que acabamos de leer: si alguien la cambió entre
  // la lectura y esto, `count` es 0 y no se pisa su decisión.
  const r = await p.tenant.updateMany({
    where: { id: antes.id, status: antes.status },
    data: { status: 'ACTIVE', suspendedAt: null },
  });
  if (r.count === 0) {
    console.log('\nNo se tocó nada: la cuenta cambió de estado mientras corría esto.');
    return p.$disconnect();
  }

  await p.auditLog.create({
    data: {
      actorId: null,
      tenantId: antes.id,
      action: 'tenant.status_changed',
      resource: `tenant:${antes.id}`,
      metadata: {
        from: antes.status,
        to: 'ACTIVE',
        brandName: antes.brandName,
        motivo:
          'Reactivada a mano: la suspendió el webhook de cancelación de Stripe ' +
          'el 2026-09-26 teniendo pagado hasta el 2026-10-26. La cuenta vive de ' +
          'crédito de marca y no le paga a ninguna pasarela.',
        via: 'scripts/reactivar-sellea.cjs',
      },
    },
  });

  const despues = await p.tenant.findUnique({
    where: { id: antes.id },
    select: { status: true, suspendedAt: true, currentPeriodEnd: true },
  });
  console.log('\n=== DESPUÉS ===');
  console.log('  estado         :', despues.status);
  console.log('  suspendida el  :', despues.suspendedAt?.toISOString() ?? '—');
  console.log('  fin de periodo :', despues.currentPeriodEnd?.toISOString() ?? '—');
  console.log(
    '\nListo. El panel tarda como mucho 30 segundos en enterarse (la caché de ' +
      'estado del guard dura eso).',
  );

  await p.$disconnect();
})().catch(async (e) => {
  console.error('ERROR:', e.message);
  await p.$disconnect();
  process.exit(1);
});
