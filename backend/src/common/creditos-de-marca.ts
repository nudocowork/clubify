import { ForbiddenException } from '@nestjs/common';
import { cycleCreditCostForTenant } from './business-types';
import type { PrismaService } from './prisma/prisma.service';

/**
 * Cobro del crédito de una marca blanca al ACTIVAR uno de sus negocios.
 *
 * POR QUÉ VIVE AQUÍ Y NO EN `TenantsService`
 * ------------------------------------------
 * Estaba solo en `TenantsService`, privado, y lo usaban las tres acciones del
 * panel («marcar activo», «marcar pagado», «pago manual»). Pero el panel no es
 * la única puerta: **el Onboarding activa negocios por su cuenta**
 * (`onboarding-sync.service.ts → activate`), y esa vía no cobraba nada.
 *
 * Así entró Smart Solutions el 2026-09-10: ACTIVO, de Sellea, sin un solo
 * movimiento de crédito y sin línea de auditoría. A Humberto no se le descontó.
 *
 * Es una función suelta —no un servicio de Nest— a propósito: `TenantsModule`
 * ya importa `OnboardingSyncModule` para el webhook, así que un servicio nuevo
 * en cualquiera de los dos lados crea un ciclo de módulos. Esto solo necesita
 * el Prisma que le pasen.
 *
 * NO cobra cuando: el negocio YA estaba activo (no se recobra al editar), no
 * tiene marca, la marca es Clubify (va por Hotmart, no por créditos), la marca
 * es ilimitada, o el coste sale 0 (InfoLink FREE es de captación).
 *
 * LA TERCERA PUERTA: EL COBRO DE LA PASARELA (2026-09-14)
 * ------------------------------------------------------
 * Tampoco cobraba nada cuando al negocio lo activa un PAGO (webhook de Stripe).
 * Ahí vivía otra regla aparte —`consumeTrialConversionCredit`— que solo entraba
 * si la suscripción había tenido prueba, y para saberlo le preguntaba a Stripe
 * por la suscripción. En Sellea esa pregunta devuelve 401 desde siempre (su
 * `secretKey` guardada es un Destination ID `ed_…`, no una `sk_live_…`), el
 * error se tragaba con un `warn`, y la conversión de prueba a plan pagado NUNCA
 * consumió un crédito. Es el caso «demo demo»: pagó $80 el 6 de septiembre y a
 * Sellea no se le descontó nada.
 *
 * Por eso el cobro por pago se hace ACÁ y con el mismo disparador que las otras
 * dos puertas —el negocio pasa a ACTIVE—, que es un hecho de nuestra base y no
 * depende de que la pasarela conteste. Con `noBloquear`, que es la única
 * diferencia: al que ya pagó no se le puede negar el servicio.
 */

export type NegocioParaCobro = {
  id: string;
  whiteLabelId: string | null;
  status: string;
  brandName: string;
  businessType?: string | null;
  infolinkTier?: string | null;
  planPeriodicity?: string | null;
};

export type CobroDeActivacion = {
  /** Créditos descontados. 0 = no había nada que cobrar. */
  cobrado: number;
  /**
   * Créditos que la marca QUEDÓ A DEBER: el negocio se activó y no había saldo.
   * Solo puede salir >0 con `noBloquear` (el cobro de una pasarela). 0 en el
   * resto de los casos, porque ahí la falta de crédito corta la activación.
   */
  faltanCreditos: number;
  /** Devuelve el crédito. Llamar si la activación falla DESPUÉS del cobro. */
  rollback: () => Promise<void>;
  /** Deja el movimiento anotado. Llamar cuando la activación ya es un hecho. */
  commit: () => Promise<void>;
};

export type OpcionesDeCobro = {
  /**
   * El cobro NO puede impedir la activación.
   *
   * Es para los webhooks de las pasarelas: el cliente YA PAGÓ. Negarle el
   * servicio porque su marca se quedó sin créditos sería cobrarle y no
   * entregarle. Sin saldo, el negocio se activa igual y queda un movimiento de
   * AJUSTE (importe 0, no mueve el saldo) diciendo cuánto quedó a deber, para
   * que se vea en el historial de la marca y se pueda regularizar.
   */
  noBloquear?: boolean;
};

const SIN_COBRO: CobroDeActivacion = {
  cobrado: 0,
  faltanCreditos: 0,
  rollback: async () => {},
  commit: async () => {},
};

export async function cobrarCreditoDeActivacion(
  prisma: PrismaService,
  negocio: NegocioParaCobro,
  origen: string,
  opciones: OpcionesDeCobro = {},
): Promise<CobroDeActivacion> {
  // Solo al PASAR a ACTIVE. Si ya lo estaba, editar el negocio no vuelve a
  // cobrar — es lo que evita que guardar dos veces cueste dos créditos.
  if (negocio.status === 'ACTIVE' || !negocio.whiteLabelId) return SIN_COBRO;

  const marca = await prisma.whiteLabel.findUnique({
    where: { id: negocio.whiteLabelId },
    select: { id: true, slug: true, creditsUnlimited: true },
  });
  if (!marca || marca.slug === 'clubify' || marca.creditsUnlimited) return SIN_COBRO;

  const coste = cycleCreditCostForTenant(
    negocio.businessType,
    negocio.infolinkTier,
    negocio.planPeriodicity,
  );
  if (coste <= 0) return SIN_COBRO;

  // `updateMany` con guarda en el WHERE, no leer-decidir-escribir: si otra
  // operación bajó los créditos entre la lectura y el descuento, `count` sale 0
  // y no se descuenta de más.
  const debito = await prisma.whiteLabel.updateMany({
    where: { id: marca.id, creditsAvailable: { gte: coste } },
    data: {
      creditsAvailable: { decrement: coste },
      creditsUsed: { increment: coste },
    },
  });
  if (debito.count === 0) {
    if (!opciones.noBloquear) {
      throw new ForbiddenException(
        'La marca no tiene créditos disponibles. Compra un pack para activar este negocio.',
      );
    }
    // Pagó y no hay saldo: se activa igual y queda anotado lo que falta. El
    // importe va en 0 a propósito — el saldo NO se toca, esto es una nota de
    // auditoría, no un consumo. Si fuera negativo, el panel de la marca
    // enseñaría créditos que nunca compró.
    return {
      cobrado: 0,
      faltanCreditos: coste,
      rollback: async () => {},
      commit: async () => {
        await prisma.creditTransaction
          .create({
            data: {
              whiteLabelId: marca.id,
              type: 'ADJUSTMENT',
              amount: 0,
              tenantId: negocio.id,
              note:
                `Activación (${origen}) SIN CRÉDITOS · ${negocio.brandName} · ` +
                `quedan a deber ${coste} créd`,
            },
          })
          .catch(() => undefined);
      },
    };
  }

  return {
    cobrado: coste,
    faltanCreditos: 0,
    rollback: async () => {
      await prisma.whiteLabel
        .update({
          where: { id: marca.id },
          data: {
            creditsAvailable: { increment: coste },
            creditsUsed: { decrement: coste },
          },
        })
        .catch(() => undefined);
    },
    commit: async () => {
      await prisma.creditTransaction
        .create({
          data: {
            whiteLabelId: marca.id,
            type: 'CONSUME',
            amount: -coste,
            tenantId: negocio.id,
            note: `Activación (${origen}) · ${negocio.brandName} · ${coste} créd`,
          },
        })
        .catch(() => undefined);
    },
  };
}
