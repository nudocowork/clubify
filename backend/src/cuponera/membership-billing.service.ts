import { Injectable, Logger } from '@nestjs/common';
import {
  BenefitCampaign,
  MembershipPlan,
  PaymentGateway,
} from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { CuponeraService } from './cuponera.service';

/**
 * Cobros de membresías de cuponera (spec §24-25), agnóstico de pasarela.
 *
 * Por qué existe separado de MercadoPagoService: MercadoPago habla con la API de
 * MP para CREAR la suscripción; Hotmart y Stripe no necesitan eso — el comprador
 * paga en un link que ya existe (checkout de Hotmart / Payment Link de Stripe) y
 * lo único nuestro es el webhook. Lo que las tres comparten es lo que pasa
 * DESPUÉS del pago: dar de alta al beneficiario, emitirle la tarjeta Wallet,
 * renovarlo o darlo de baja. Eso vive acá y lo llaman las tres.
 *
 * Los métodos devuelven un string de acción (nunca lanzan hacia el webhook): el
 * caller siempre responde 200 a la pasarela y el string queda en el log.
 */

/** Plan comprado + la cuponera a la que pertenece. */
export type PlanMatch = { plan: MembershipPlan; campaign: BenefitCampaign };

export type ActivateInput = {
  match: PlanMatch;
  provider: PaymentGateway;
  /** Id del cobro concreto. Es la clave de idempotencia de la orden. */
  transactionRef: string;
  /** Id de la suscripción recurrente, si la hay. Es lo que traen después la
   *  renovación y la cancelación para encontrar al miembro. */
  subscriptionRef?: string | null;
  email: string;
  fullName?: string | null;
  phone?: string | null;
  amountCents?: number | null;
  currency?: string | null;
  /** Próxima fecha de cobro según la pasarela. Manda sobre el intervalo del plan. */
  expiresAt?: Date | null;
  raw?: unknown;
};

export type LifecycleInput = {
  provider: PaymentGateway;
  /** Referencia recurrente o del cobro; se busca por las dos. */
  ref: string | null | undefined;
  /** Fallback cuando la pasarela no manda referencia utilizable. */
  email?: string | null;
  reason: string;
};

@Injectable()
export class MembershipBillingService {
  private logger = new Logger(MembershipBillingService.name);

  constructor(
    private prisma: PrismaService,
    private cuponera: CuponeraService,
  ) {}

  // ---------------------------------------------------------------------------
  // Traducción producto-de-pasarela → plan
  // ---------------------------------------------------------------------------

  /**
   * Hotmart manda el id de SU producto, no el de nuestro plan. Varias ofertas
   * (mensual/anual) suelen compartir productId, así que se desambigua por
   * offer.code — y si no se puede, NO se adivina: dar de alta en el plan
   * equivocado es peor que no dar de alta, porque el miembro queda con la
   * vigencia y los beneficios de otro plan. Mismo criterio que los packs de
   * créditos en HotmartService.tryHandleCreditPurchase.
   */
  async matchHotmartPlan(
    productId: string | null | undefined,
    offerCode: string | null | undefined,
  ): Promise<PlanMatch | 'ambiguous' | null> {
    if (!productId) return null;
    const planes = await this.prisma.membershipPlan.findMany({
      where: { hotmartProductId: String(productId), isActive: true },
    });
    if (!planes.length) return null;

    const offer = offerCode?.trim() || null;
    let plan = offer ? planes.find((p) => p.hotmartOfferCode === offer) ?? null : null;
    if (!plan) {
      if (planes.length === 1) {
        plan = planes[0];
      } else {
        this.logger.error(
          `[CUPONERA-PAGOS] producto Hotmart ${productId} está mapeado a ${planes.length} planes ` +
            `y la oferta '${offer ?? '(sin offer en el payload)'}' no matchea ninguno. ` +
            `Asigná hotmartOfferCode a cada plan.`,
        );
        return 'ambiguous';
      }
    }
    return this.withCampaign(plan);
  }

  /** Stripe identifica el producto por price id, que es único: sin ambigüedad. */
  async matchStripePlan(priceId: string | null | undefined): Promise<PlanMatch | null> {
    if (!priceId) return null;
    const plan = await this.prisma.membershipPlan.findFirst({
      where: { stripePriceId: priceId, isActive: true },
    });
    return plan ? this.withCampaign(plan) : null;
  }

  private async withCampaign(plan: MembershipPlan): Promise<PlanMatch | null> {
    const campaign = await this.prisma.benefitCampaign.findUnique({
      where: { id: plan.campaignId },
    });
    if (!campaign) return null;
    // Una cuponera en DRAFT o PAUSED NO invalida el pago: la plata ya se cobró y
    // el comprador tiene que recibir su tarjeta igual. Se avisa y se sigue.
    if (campaign.status !== 'ACTIVE') {
      this.logger.warn(
        `[CUPONERA-PAGOS] pago sobre la cuponera "${campaign.slug}" que está en ${campaign.status}. ` +
          `Se da de alta igual (el cobro ya ocurrió), pero la cartelera no es pública todavía.`,
      );
    }
    return { plan, campaign };
  }

  // ---------------------------------------------------------------------------
  // Alta / renovación / baja
  // ---------------------------------------------------------------------------

  /**
   * Pago aprobado → beneficiario activo con su tarjeta Wallet emitida (§24).
   * Idempotente por transactionRef: la pasarela reintenta el mismo webhook y no
   * se puede cobrar ni dar de alta dos veces.
   */
  async activate(input: ActivateInput): Promise<string> {
    const { match, provider, transactionRef } = input;
    const email = (input.email || '').trim().toLowerCase();

    const yaProcesada = await this.prisma.membershipOrder.findFirst({
      where: { provider, providerRef: transactionRef, status: 'PAID' },
      select: { id: true },
    });
    if (yaProcesada) return 'cuponera_membership_duplicate';

    const order = await this.prisma.membershipOrder.create({
      data: {
        campaignId: match.campaign.id,
        planId: match.plan.id,
        email,
        amountCents: input.amountCents ?? match.plan.priceCents,
        currency: input.currency ?? match.plan.currency,
        status: 'PENDING',
        provider,
        providerRef: transactionRef,
        rawPayload: {
          subscriber: {
            fullName: input.fullName ?? '',
            phone: input.phone ?? '',
            email,
          },
          subscriptionRef: input.subscriptionRef ?? null,
          event: input.raw ?? null,
        } as any,
      },
    });

    try {
      const r = await this.cuponera.enrollMember({
        campaignId: match.campaign.id,
        planId: match.plan.id,
        fullName: input.fullName?.trim() || email,
        phone: input.phone ?? '',
        email,
        source: provider === 'HOTMART' ? 'HOTMART' : provider === 'STRIPE' ? 'STRIPE' : 'MERCADOPAGO',
        provider,
        providerRef: input.subscriptionRef ?? transactionRef,
        expiresAt: input.expiresAt ?? null,
      });
      await this.prisma.membershipOrder.update({
        where: { id: order.id },
        data: { status: 'PAID', customerId: r.customerId },
      });
      this.logger.log(
        `[CUPONERA-PAGOS] alta OK · cuponera=${match.campaign.slug} plan="${match.plan.name}" ` +
          `pasarela=${provider} tx=${transactionRef} miembro=${r.customerId} pase=${r.passId}`,
      );
      return 'cuponera_membership_activated';
    } catch (e: any) {
      // La orden queda FAILED a propósito: es un pago cobrado que no llegó a
      // dar de alta, y tiene que verse en el panel para resolverlo a mano.
      await this.prisma.membershipOrder
        .update({
          where: { id: order.id },
          data: {
            status: 'FAILED',
            rawPayload: {
              ...(order.rawPayload as any),
              error: e?.message ?? 'error',
            } as any,
          },
        })
        .catch(() => null);
      this.logger.error(
        `[CUPONERA-PAGOS] COBRADO PERO SIN ALTA · tx=${transactionRef} email=${email} ` +
          `motivo=${e?.message ?? 'error'}`,
      );
      return 'cuponera_membership_enroll_failed';
    }
  }

  /** Renovación: corre el vencimiento. No re-emite la tarjeta ni toca el plan. */
  async renew(input: {
    provider: PaymentGateway;
    ref: string | null | undefined;
    email?: string | null;
    until?: Date | null;
    transactionRef?: string | null;
    amountCents?: number | null;
    currency?: string | null;
  }): Promise<string> {
    const membership = await this.findMembership(input.provider, input.ref, input.email);
    if (!membership) return 'cuponera_membership_not_found';

    const until = input.until ?? this.siguienteCiclo(membership.expiresAt);
    await this.prisma.livingMembership.update({
      where: { id: membership.id },
      data: {
        status: 'ACTIVE',
        expiresAt: until,
        // Una renovación que llega sobre una membresía vencida la revive: es
        // exactamente el caso "se le cayó la tarjeta y después pagó".
        ...(membership.status !== 'ACTIVE' ? { activatedAt: new Date() } : {}),
      },
    });

    if (input.transactionRef) {
      await this.prisma.membershipOrder
        .create({
          data: {
            campaignId: membership.campaignId,
            planId: membership.planId,
            customerId: membership.customerId,
            email: input.email?.trim().toLowerCase() ?? '',
            amountCents: input.amountCents ?? 0,
            currency: input.currency ?? 'COP',
            status: 'PAID',
            provider: input.provider,
            providerRef: input.transactionRef,
            rawPayload: { renewal: true } as any,
          },
        })
        .catch(() => null);
    }
    return 'cuponera_membership_renewed';
  }

  /**
   * Baja (cancelación, reembolso, contracargo). Se corta el acceso en el acto,
   * igual que hace la plataforma con un tenant (HotmartService, caso
   * SUBSCRIPTION_CANCELLATION → SUSPENDED). Si algún día se decide respetar el
   * período ya pagado, es cambiar CANCELLED por dejar el status y adelantar
   * expiresAt: el candado de canje mira las dos cosas.
   */
  async deactivate(input: LifecycleInput): Promise<string> {
    const membership = await this.findMembership(input.provider, input.ref, input.email);
    if (!membership) return 'cuponera_membership_not_found';
    if (membership.status === 'CANCELLED') return 'cuponera_membership_already_cancelled';

    await this.prisma.livingMembership.update({
      where: { id: membership.id },
      data: { status: 'CANCELLED' },
    });
    this.logger.log(
      `[CUPONERA-PAGOS] baja · miembro=${membership.customerId} pasarela=${input.provider} ` +
        `motivo=${input.reason}`,
    );
    return 'cuponera_membership_cancelled';
  }

  /**
   * Pago fallido. NO da de baja: las pasarelas reintentan durante días y cortar
   * al primer rechazo deja afuera a gente que sí termina pagando. Se registra la
   * orden fallida (para que se vea en el panel) y el acceso se cae solo cuando
   * vence la membresía, que es el criterio del candado de canje.
   */
  async paymentFailed(input: LifecycleInput): Promise<string> {
    const membership = await this.findMembership(input.provider, input.ref, input.email);
    if (!membership) return 'cuponera_membership_not_found';
    await this.prisma.membershipOrder
      .create({
        data: {
          campaignId: membership.campaignId,
          planId: membership.planId,
          customerId: membership.customerId,
          email: input.email?.trim().toLowerCase() ?? '',
          status: 'FAILED',
          provider: input.provider,
          providerRef: input.ref ?? null,
          rawPayload: { reason: input.reason } as any,
        },
      })
      .catch(() => null);
    this.logger.warn(
      `[CUPONERA-PAGOS] pago fallido · miembro=${membership.customerId} ` +
        `pasarela=${input.provider} vence=${membership.expiresAt?.toISOString() ?? '-'}`,
    );
    return 'cuponera_membership_payment_failed';
  }

  // ---------------------------------------------------------------------------

  /**
   * Busca la membresía por la referencia de la pasarela y, si no aparece, por
   * email. El email es el fallback y no la clave: dos cuponeras pueden tener al
   * mismo comprador, así que solo sirve cuando la referencia falta.
   */
  private async findMembership(
    provider: PaymentGateway,
    ref: string | null | undefined,
    email?: string | null,
  ) {
    if (ref) {
      const porRef = await this.prisma.livingMembership.findFirst({
        where: { providerRef: ref },
        orderBy: { createdAt: 'desc' },
      });
      if (porRef) return porRef;
      // Histórico MercadoPago: las membresías anteriores a §24 solo tienen el
      // preapproval en su columna vieja.
      const porMp = await this.prisma.livingMembership.findFirst({
        where: { mpPreapprovalId: ref },
        orderBy: { createdAt: 'desc' },
      });
      if (porMp) return porMp;
    }

    const mail = email?.trim().toLowerCase();
    if (!mail) return null;
    const orden = await this.prisma.membershipOrder.findFirst({
      where: { email: mail, provider, status: 'PAID', customerId: { not: null } },
      orderBy: { createdAt: 'desc' },
    });
    if (!orden?.customerId) return null;
    return this.prisma.livingMembership.findFirst({
      where: { campaignId: orden.campaignId, customerId: orden.customerId },
    });
  }

  /** Un ciclo más desde hoy (o desde el vencimiento si todavía no pasó). */
  private siguienteCiclo(desde: Date | null): Date {
    const base = desde && desde.getTime() > Date.now() ? new Date(desde) : new Date();
    base.setMonth(base.getMonth() + 1);
    return base;
  }
}
