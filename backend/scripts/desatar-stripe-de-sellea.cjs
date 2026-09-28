/**
 * Le quita a la cuenta SELLEA (`prueba-selleala`) la suscripción de Stripe que
 * arrastraba y que no le corresponde.
 *
 * POR QUÉ: esa cuenta vive del CRÉDITO DE LA MARCA (`wl-…`) y no tiene precio
 * de suscripción — no le paga nada a ninguna pasarela—. Pero conservaba un
 * `stripeSubscriptionId` y un `stripeCustomerId` de antes, y por ahí la
 * encontró el webhook de cancelación del 26 de septiembre y la apagó, teniendo
 * pagado hasta el 26 de octubre.
 *
 * El código ya la protege (`laPasarelaMandaSobreElNegocio` en
 * `billing/cancelacion.ts`), pero mientras los identificadores sigan ahí el
 * webhook la sigue ENCONTRANDO — `findTenant` busca justo por esos dos campos.
 * Esto le quita el cable, que es lo que sobraba. Javier, 2026-09-28.
 *
 * LOS IDENTIFICADORES NO SE PIERDEN: quedan guardados en `AuditLog` antes de
 * limpiarlos, así que esto se puede revertir. No se imprimen enteros por
 * pantalla.
 *
 * Toca UNA fila y DOS campos. Idempotente: si ya están limpios, no hace nada.
 *
 * Uso:  railway run node scripts/desatar-stripe-de-sellea.cjs
 */
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient({
  datasources: {
    db: { url: process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL },
  },
});

const SLUG = 'prueba-selleala';
/** Nunca el identificador entero por pantalla. */
const corto = (v) => (v ? `${String(v).slice(0, 6)}… (puesto)` : '—');

(async () => {
  const t = await p.tenant.findFirst({
    where: { slug: SLUG },
    select: {
      id: true,
      brandName: true,
      status: true,
      stripeCustomerId: true,
      stripeSubscriptionId: true,
      hotmartSubscriberCode: true,
      subscriptionPriceUsd: true,
      currentPeriodEnd: true,
    },
  });
  if (!t) {
    console.log(`No existe ningún negocio con slug "${SLUG}".`);
    return p.$disconnect();
  }

  console.log('=== ANTES ===');
  console.log('  negocio         :', t.brandName, '|', t.status);
  console.log('  suscripcion     :', corto(t.stripeSubscriptionId));
  console.log('  cliente Stripe  :', corto(t.stripeCustomerId));
  console.log('  precio          :', t.subscriptionPriceUsd ?? '— (no paga)');
  console.log('  fin de periodo  :', t.currentPeriodEnd?.toISOString() ?? '—');

  // Guarda de seguridad: esto SOLO vale para una cuenta que no paga por
  // pasarela. A una que sí paga, quitarle el cable la dejaría sin renovar y sin
  // que nadie se enterara — mucho peor que el problema que se arregla.
  const precio = Number(t.subscriptionPriceUsd ?? 0);
  const codigo = (t.hotmartSubscriberCode ?? '').trim();
  const noPagaPorPasarela =
    !(Number.isFinite(precio) && precio > 0) &&
    (!codigo || /^(wl-|comp-|trial-|campaign-|sim-)/i.test(codigo));
  if (!noPagaPorPasarela) {
    console.log(
      '\nABORTADO: este negocio SÍ paga por pasarela. Quitarle la suscripción ' +
        'lo dejaría sin renovar. No se toca nada.',
    );
    return p.$disconnect();
  }

  if (!t.stripeSubscriptionId && !t.stripeCustomerId) {
    console.log('\nYa está desatada. No hay nada que hacer.');
    return p.$disconnect();
  }

  // El `where` lleva los valores que acabamos de leer: si alguien los cambió
  // entre la lectura y esto, `count` es 0 y no se pisa su decisión.
  const r = await p.tenant.updateMany({
    where: {
      id: t.id,
      stripeSubscriptionId: t.stripeSubscriptionId,
      stripeCustomerId: t.stripeCustomerId,
    },
    data: { stripeSubscriptionId: null, stripeCustomerId: null },
  });
  if (r.count === 0) {
    console.log('\nNo se tocó nada: la cuenta cambió mientras corría esto.');
    return p.$disconnect();
  }

  await p.auditLog.create({
    data: {
      actorId: null,
      tenantId: t.id,
      action: 'tenant.stripe_unlinked',
      resource: `tenant:${t.id}`,
      metadata: {
        brandName: t.brandName,
        motivo:
          'La cuenta vive del crédito de la marca y no paga por pasarela, pero ' +
          'arrastraba una suscripción de Stripe por la que el webhook de ' +
          'cancelación la encontró y la apagó el 2026-09-26.',
        // Se guardan ENTEROS para poder revertir. Están en la base, no en un log.
        stripeSubscriptionId: t.stripeSubscriptionId,
        stripeCustomerId: t.stripeCustomerId,
        via: 'scripts/desatar-stripe-de-sellea.cjs',
      },
    },
  });

  const d = await p.tenant.findUnique({
    where: { id: t.id },
    select: { status: true, stripeSubscriptionId: true, stripeCustomerId: true, currentPeriodEnd: true },
  });
  console.log('\n=== DESPUÉS ===');
  console.log('  estado          :', d.status);
  console.log('  suscripcion     :', corto(d.stripeSubscriptionId));
  console.log('  cliente Stripe  :', corto(d.stripeCustomerId));
  console.log('  fin de periodo  :', d.currentPeriodEnd?.toISOString() ?? '—');
  console.log(
    '\nListo. Ningún webhook de Stripe puede volver a encontrarla por esos dos ' +
      'campos. Los identificadores quedaron guardados en AuditLog ' +
      '(tenant.stripe_unlinked) por si hay que revertirlo.',
  );

  await p.$disconnect();
})().catch(async (e) => {
  console.error('ERROR:', e.message);
  await p.$disconnect();
  process.exit(1);
});
