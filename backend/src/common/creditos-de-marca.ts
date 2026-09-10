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
  /** Devuelve el crédito. Llamar si la activación falla DESPUÉS del cobro. */
  rollback: () => Promise<void>;
  /** Deja el movimiento anotado. Llamar cuando la activación ya es un hecho. */
  commit: () => Promise<void>;
};

const SIN_COBRO: CobroDeActivacion = {
  cobrado: 0,
  rollback: async () => {},
  commit: async () => {},
};

export async function cobrarCreditoDeActivacion(
  prisma: PrismaService,
  negocio: NegocioParaCobro,
  origen: string,
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
    throw new ForbiddenException(
      'La marca no tiene créditos disponibles. Compra un pack para activar este negocio.',
    );
  }

  return {
    cobrado: coste,
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
