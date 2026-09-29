import { BusinessType, Prisma } from '@prisma/client';

/**
 * Quién recibe MENSAJES del ciclo de cobro — la serie pre-cobro (D-7, D-3,
 * D-1, día del cobro) y la secuencia de mora. REGLA ÚNICA: las cinco
 * selecciones de `BillingService` la comparten para que no puedan divergir.
 *
 *  - Negocios de Clubify (sin marca, o marca `clubify`) y de marcas que
 *    cobran DIRECTO por Stripe (PDF 1256 §4): sus negocios sí pagan
 *    suscripción y el recordatorio les habla de un cobro real.
 *  - Nunca quien ya canceló (decisión de Javier, 2026-09-10): cobrarle de
 *    nuevo no está en el plan y recordárselo solo hace ruido.
 *  - Nunca un host de campaña.
 *  - NUNCA un INFOLINK (reporte de Humberto vía Javier, 2026-09-29): para el
 *    negocio es GRATIS —lo paga su marca con créditos—, así que «verifica que
 *    tu tarjeta tenga fondos» le anuncia un cobro que no existe. Pasó de
 *    verdad: Corks Arts (InfoLink de Sellea) recibió los recordatorios D-7 y
 *    D-3 por SMS y correo (MessageLog, 24 y 28 de septiembre de 2026).
 *    `businessType` es un enum NOT NULL con default FULL, así que el `not`
 *    basta — no hay filas en null que un `<>` de SQL dejaría fuera.
 *
 * El AND se expone como array a propósito: la vía de mora necesita componer
 * su propio OR (fallo de cobro / fecha vencida) sin pisar el de las marcas.
 */
export function quienRecibeMensajesDeCobro(): Prisma.TenantWhereInput & {
  AND: Prisma.TenantWhereInput[];
} {
  return {
    canceledAt: null,
    isCampaignHost: false,
    businessType: { not: BusinessType.INFOLINK },
    AND: [
      {
        OR: [
          { whiteLabelId: null },
          { whiteLabel: { slug: 'clubify' } },
          { whiteLabel: { paymentGateway: 'STRIPE' } },
        ],
      },
    ],
  };
}
