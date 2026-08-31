import { Injectable, Logger } from '@nestjs/common';
import Stripe from 'stripe';
import { PrismaService } from '../common/prisma/prisma.service';
import { GrowBusinessService } from '../integrations/grow-business.service';
import { BillingService } from './billing.service';
import { PendingActivationService } from './pending-activation.service';
import { SmsTemplatesService } from './sms-templates.service';
import { BrandEmailService } from '../email/brand-email.service';
import { fmtEmailDate } from '../email/brand-email-templates';
import { isBrandTemplateSendEnabled } from '../integrations/brand-message-templates';
import { addPlanPeriod } from '../common/plan-period';
import { cycleCreditCostForTenant } from '../common/business-types';
import { fmtSmsDate } from './sms-templates';
import { decryptSecret } from '../common/crypto/secret-box';
import { OnboardingWebhookService } from '../onboarding-sync/onboarding-webhook.service';
import { HotmartService } from './hotmart.service';
import { IncomeRecordService } from '../finance/income-record.service';
import { invalidateBusinessTypeCache } from '../common/guards/infolink-only.guard';
import { ModuleRef } from '@nestjs/core';
import { MembershipBillingService } from '../cuponera/membership-billing.service';

/** Contexto extraído de un evento de pago Stripe, normalizado. */
type StripeCtx = {
  email: string | null;
  customerId: string | null;
  subscriptionId: string | null;
  priceId: string | null;
  nextCharge: Date | null;
  amountUsd: number | null;
  // PDF Soft 10: timestamp real del pago (event.created) para fijar purchasedAt.
  paidAt: Date | null;
  // Fin de la PRUEBA de la suscripción (Stripe trial_end), si la tuvo. Distingue
  // el "enlace de 7 días de prueba" (trialEnd != null) de la compra directa
  // (sin prueba → null). Ver consumeTrialConversionCredit.
  trialEnd: Date | null;
  /**
   * Identidad UNICA de este cobro, para deduplicar comisiones.
   *
   * Es la factura (`in_…`) o, si no la hay, el id del evento. NUNCA el id de
   * suscripcion: ese es constante entre renovaciones, y usarlo como clave
   * haria que solo la PRIMERA renovacion generara comision.
   */
  transaccionId: string | null;
};

type BrandCtx = {
  whiteLabelId: string;
  slug: string;
  client: Stripe;
  webhookSecret: string;
};

/**
 * Nombre y teléfono del comprador según el tipo de evento: el checkout los
 * trae en `customer_details`, los invoice.* en `customer_name`/`customer_phone`.
 * Acepta el evento vivo o el rawPayload guardado en PendingStripePayment (por
 * eso el tipo laxo). Sin datos devuelve nulls — el aviso cae a solo correo.
 */
function buyerContactOf(eventLike: unknown): {
  name: string | null;
  phone: string | null;
} {
  const obj = (eventLike as { data?: { object?: any } })?.data?.object ?? {};
  const cd = obj?.customer_details ?? {};
  return {
    name: cd?.name ?? obj?.customer_name ?? null,
    phone: cd?.phone ?? obj?.customer_phone ?? null,
  };
}

/**
 * Pasarela Stripe por marca blanca (cuenta PROPIA por marca). El cobro se hace
 * con Stripe Payment Links (la marca pega su link en el config); nosotros solo
 * procesamos el webhook firmado con SU webhookSecret. Espeja el flujo de
 * Hotmart: activación, pending "pago → datos", SMS, idempotencia y
 * **comisiones de referido**.
 *
 * Las comisiones estaban excluidas a propósito: se asumía que el programa de
 * afiliados era de Clubify y no de las marcas blancas. Se cambió el 2026-08-24
 * a pedido de Javier, porque Sellea cobra por Stripe y quiere su propio
 * programa de referidos. Con la exclusión, su panel dejaba crear afiliados,
 * generar enlaces y atribuir registros — todo se veía funcionar hasta que
 * tocaba pagar, y ahí la columna de dinero estaba en cero.
 *
 * Las comisiones quedan acotadas a la marca: el afiliado lleva el
 * `whiteLabelId` de quien lo creó, así que las de Sellea son de Sellea.
 */
@Injectable()
export class StripeService {
  private readonly logger = new Logger(StripeService.name);

  /**
   * MembershipBillingService se resuelve TARDE y por el contenedor, no por
   * inyección: importar CuponeraModule desde acá cierra el ciclo
   * Billing → Cuponera → Locations → Tenants → Billing. Con ModuleRef no hay
   * arista en el grafo de módulos.
   *
   * Si el módulo de cuponera no está montado (un deploy sin él), devuelve null y
   * el webhook sigue su curso normal en vez de romperse.
   */
  private cuponeraBillingRef: MembershipBillingService | null | undefined;

  private cuponeraBilling(): MembershipBillingService | null {
    if (this.cuponeraBillingRef === undefined) {
      try {
        this.cuponeraBillingRef = this.moduleRef.get(MembershipBillingService, {
          strict: false,
        });
      } catch {
        this.logger.warn(
          'CuponeraModule no está montado: los webhooks no darán de alta membresías de cuponera.',
        );
        this.cuponeraBillingRef = null;
      }
    }
    return this.cuponeraBillingRef ?? null;
  }

  constructor(
    private prisma: PrismaService,
    private moduleRef: ModuleRef,
    private billing: BillingService,
    private growBusiness: GrowBusinessService,
    private smsTemplates: SmsTemplatesService,
    private brandEmail: BrandEmailService,
    private onboardingWebhook: OnboardingWebhookService,
    private pendingActivation: PendingActivationService,
    // Las comisiones de referido las genera un metodo agnostico de pasarela
    // que vive en HotmartService por historia (nacio dentro de su webhook).
    // Sin esta llamada, una marca que cobra por Stripe podia tener afiliados,
    // enlaces y atribucion funcionando y no generar NI UNA comision.
    private hotmart: HotmartService,
    // CONTABILIDAD Fase 1: registra el ingreso real por cobro (histórico +
    // fee/impuesto/neto). Best-effort, aditivo, no afecta la activación.
    private incomeRecord: IncomeRecordService,
  ) {}

  /** Carga la marca por slug + descifra secretKey/webhookSecret y arma el
   *  cliente Stripe. Null si la marca no usa Stripe o no está configurada. */
  private async loadBrand(slug: string): Promise<BrandCtx | null> {
    const s = (slug ?? '').trim().toLowerCase();
    if (!s) return null;
    const wl = await this.prisma.whiteLabel.findFirst({
      where: { slug: s, status: 'ACTIVE' },
      select: { id: true, slug: true, paymentGateway: true, paymentConfig: true },
    });
    if (!wl || wl.paymentGateway !== 'STRIPE') return null;
    const cfg = (wl.paymentConfig as Record<string, any>) || {};
    if (!cfg.secretKey || !cfg.webhookSecret) return null;
    let secretKey: string;
    let webhookSecret: string;
    try {
      secretKey = decryptSecret(cfg.secretKey);
      webhookSecret = decryptSecret(cfg.webhookSecret);
    } catch {
      return null;
    }
    return {
      whiteLabelId: wl.id,
      slug: wl.slug,
      client: new Stripe(secretKey),
      webhookSecret,
    };
  }

  /** Verifica la firma del webhook contra el webhookSecret de la marca y
   *  devuelve { brand, event }. Null si la firma no valida o la marca no
   *  está configurada. Requiere el RAW body (Buffer). */
  async constructEventForBrand(
    slug: string,
    rawBody: Buffer,
    signature: string | undefined,
  ): Promise<{ brand: BrandCtx; event: Stripe.Event } | null> {
    const brand = await this.loadBrand(slug);
    if (!brand || !signature || !rawBody) return null;
    try {
      const event = brand.client.webhooks.constructEvent(
        rawBody,
        signature,
        brand.webhookSecret,
      );
      return { brand, event };
    } catch (e) {
      this.logger.warn(`Stripe firma inválida (${slug}): ${(e as Error).message}`);
      return null;
    }
  }

  // ── Procesamiento de eventos ────────────────────────────────────────────

  async handleEvent(brand: BrandCtx, event: Stripe.Event) {
    // Idempotencia: reclamamos event.id ANTES de procesar (Stripe reintenta
    // con el mismo id). Segundo INSERT del mismo evento → P2002 → duplicate.
    try {
      await this.prisma.stripeWebhookEvent.create({
        data: {
          eventId: event.id,
          eventType: event.type,
          whiteLabelId: brand.whiteLabelId,
          payload: event as unknown as object,
        },
      });
    } catch (e: any) {
      if (e?.code === 'P2002') return { ok: true, action: 'duplicate' };
      this.logger.warn(`stripeWebhookEvent claim falló: ${e?.message}`);
    }

    // Cuponera (spec §24-25): si el price comprado está mapeado a un plan de
    // membresía, esto no es la suscripción de un negocio sino una persona
    // comprando su Living Card. Se corta antes del switch porque el flujo normal
    // buscaría un tenant, no lo encontraría y guardaría un pago pendiente
    // invitando al comprador a crear un negocio que no compró.
    const cuponera = await this.tryHandleCuponera(brand, event).catch((e) => {
      this.logger.error(`tryHandleCuponera falló: ${(e as Error)?.message}`);
      return null;
    });
    if (cuponera) return { ok: true, action: cuponera };

    switch (event.type) {
      case 'checkout.session.completed':
      case 'invoice.paid':
      case 'invoice.payment_succeeded':
        return this.onPaymentSucceeded(brand, event);
      case 'invoice.payment_failed':
        return this.onPaymentFailed(brand, event);
      case 'customer.subscription.deleted':
        return this.onSubscriptionCancelled(brand, event);
      // Reembolso / disputa / contracargo: antes caían en `unhandled`, o sea
      // que un reembolso en Stripe no suspendía ni avisaba absolutamente nada.
      case 'charge.refunded':
        return this.onChargeRefunded(brand, event);
      case 'charge.dispute.created':
        return this.onDisputeCreated(brand, event);
      case 'charge.dispute.closed':
        return this.onDisputeClosed(brand, event);
      // PDF 1256 §3: eventos antes ignorados.
      case 'invoice.upcoming':
        return this.onInvoiceUpcoming(brand, event);
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
        return this.onSubscriptionSynced(brand, event);
      case 'customer.subscription.paused':
        return this.onSubscriptionPaused(brand, event);
      case 'customer.subscription.resumed':
        return this.onSubscriptionResumed(brand, event);
      default:
        return { ok: true, action: 'unhandled' };
    }
  }

  /**
   * Membresías de cuponera compradas por Stripe (§24-25). Devuelve null cuando
   * el evento NO es de una cuponera, para que siga su curso normal.
   *
   * El precheck de una sola query evita pagarle a Stripe una llamada extra
   * (extractCtx recupera la subscription) en instalaciones que no venden
   * cuponeras por Stripe, que hoy son todas.
   */
  private async tryHandleCuponera(
    brand: BrandCtx,
    event: Stripe.Event,
  ): Promise<string | null> {
    const RELEVANTES = new Set([
      'checkout.session.completed',
      'invoice.paid',
      'invoice.payment_succeeded',
      'invoice.payment_failed',
      'customer.subscription.created',
      'customer.subscription.deleted',
    ]);
    if (!RELEVANTES.has(event.type)) return null;

    const svc = this.cuponeraBilling();
    if (!svc) return null;

    const hayPlanes = await this.prisma.membershipPlan.count({
      where: { stripePriceId: { not: null }, isActive: true },
    });
    if (!hayPlanes) return null;

    const ctx = await this.extractCtx(brand, event);
    const ref = ctx.subscriptionId ?? ctx.transaccionId ?? null;

    if (event.type === 'customer.subscription.deleted') {
      const membership = ref
        ? await this.prisma.livingMembership.findFirst({
            where: { provider: 'STRIPE', providerRef: ref },
            select: { id: true },
          })
        : null;
      if (!membership) return null;
      return svc.deactivate({
        provider: 'STRIPE',
        ref,
        email: ctx.email,
        reason: event.type,
      });
    }

    const match = await svc.matchStripePlan(ctx.priceId);
    if (!match) return null;

    if (event.type === 'invoice.payment_failed') {
      return svc.paymentFailed({
        provider: 'STRIPE',
        ref,
        email: ctx.email,
        reason: event.type,
      });
    }

    // Renovación: ya hay membresía con esta suscripción → correr vencimiento.
    if (ref) {
      const yaEs = await this.prisma.livingMembership.findFirst({
        where: { providerRef: ref },
        select: { id: true },
      });
      if (yaEs) {
        return svc.renew({
          provider: 'STRIPE',
          ref,
          email: ctx.email,
          until: ctx.nextCharge,
          transactionRef: ctx.transaccionId,
          amountCents: ctx.amountUsd != null ? Math.round(ctx.amountUsd * 100) : null,
          currency: ctx.amountUsd != null ? 'USD' : match.plan.currency,
        });
      }
    }

    if (!ctx.email) {
      this.logger.error(
        `[CUPONERA-PAGOS] evento Stripe ${event.type} sin email de comprador ` +
          `(sub=${ctx.subscriptionId ?? '-'}). No hay a quién dar de alta.`,
      );
      return 'cuponera_membership_no_email';
    }

    return svc.activate({
      match,
      provider: 'STRIPE',
      transactionRef: ctx.transaccionId ?? event.id,
      subscriptionRef: ctx.subscriptionId,
      email: ctx.email,
      fullName: null,
      phone: '',
      amountCents: ctx.amountUsd != null ? Math.round(ctx.amountUsd * 100) : null,
      currency: ctx.amountUsd != null ? 'USD' : match.plan.currency,
      expiresAt: ctx.nextCharge,
      raw: { event: event.type, id: event.id },
    });
  }

  /** Normaliza el evento a un contexto común. Para suscripciones, recupera la
   *  subscription para obtener current_period_end + priceId confiables. */
  private async extractCtx(brand: BrandCtx, event: Stripe.Event): Promise<StripeCtx> {
    const obj = event.data.object as any;
    let email: string | null = null;
    let customerId: string | null = null;
    let subscriptionId: string | null = null;
    let priceId: string | null = null;
    let amountUsd: number | null = null;
    let nextCharge: Date | null = null;
    let trialEnd: Date | null = null;
    // PDF Soft 10: fecha real del evento de pago (Unix seconds → Date).
    const paidAt =
      typeof event.created === 'number' ? new Date(event.created * 1000) : null;
    // La factura identifica el cobro; en checkout.session no hay, y el id del
    // evento sirve igual (es unico por evento).
    const transaccionId: string | null =
      (typeof obj.id === 'string' && obj.id.startsWith('in_') ? obj.id : null) ??
      (typeof obj.invoice === 'string' ? obj.invoice : null) ??
      (typeof event.id === 'string' ? event.id : null);

    if (event.type === 'checkout.session.completed') {
      email = obj.customer_details?.email ?? obj.customer_email ?? null;
      customerId = typeof obj.customer === 'string' ? obj.customer : null;
      subscriptionId = typeof obj.subscription === 'string' ? obj.subscription : null;
      if (obj.currency === 'usd' && typeof obj.amount_total === 'number') {
        amountUsd = obj.amount_total / 100;
      }
    } else {
      // invoice.*
      email = obj.customer_email ?? null;
      customerId = typeof obj.customer === 'string' ? obj.customer : null;
      subscriptionId = typeof obj.subscription === 'string' ? obj.subscription : null;
      if (obj.currency === 'usd' && typeof obj.amount_paid === 'number') {
        amountUsd = obj.amount_paid / 100;
      }
      priceId = obj.lines?.data?.[0]?.price?.id ?? null;
      const periodEnd = obj.lines?.data?.[0]?.period?.end;
      if (typeof periodEnd === 'number') nextCharge = new Date(periodEnd * 1000);
    }

    // Fuente de verdad para fecha + price: la subscription.
    if (subscriptionId) {
      try {
        const sub = await brand.client.subscriptions.retrieve(subscriptionId);
        if (typeof sub.current_period_end === 'number') {
          nextCharge = new Date(sub.current_period_end * 1000);
        }
        // trial_end queda seteado aunque la prueba ya haya terminado → sirve como
        // marca de que la suscripción nació con prueba (enlace de 7 días).
        if (typeof sub.trial_end === 'number') trialEnd = new Date(sub.trial_end * 1000);
        priceId = sub.items?.data?.[0]?.price?.id ?? priceId;
        if (!customerId && typeof sub.customer === 'string') customerId = sub.customer;
      } catch (e) {
        this.logger.warn(`retrieve subscription ${subscriptionId} falló: ${(e as Error).message}`);
      }
    }
    return { email, customerId, subscriptionId, priceId, nextCharge, amountUsd, paidAt, transaccionId, trialEnd };
  }

  private async onPaymentSucceeded(brand: BrandCtx, event: Stripe.Event) {
    const ctx = await this.extractCtx(brand, event);
    const tenant = await this.findTenant(brand.whiteLabelId, ctx);
    if (!tenant) {
      // Pago → datos: guardamos pendiente para que el signup lo consuma.
      if (ctx.email) {
        await this.storePending(brand, event, ctx).catch((e) =>
          this.logger.warn(`storePending Stripe falló: ${(e as Error).message}`),
        );
        return { ok: true, action: 'pending_stored' };
      }
      return { ok: true, action: 'tenant_not_found' };
    }
    await this.activate(tenant, ctx, brand.whiteLabelId);
    // Enlace de PRUEBA de 7 días: el crédito de la marca se consume cuando Stripe
    // COBRA la tarjeta (día 7), no al anclarla. Solo en el cobro real (invoice.*,
    // no checkout.session), y solo si la suscripción tuvo prueba. Best-effort: si
    // falla, el negocio queda activo igual y se puede reconciliar. La compra
    // directa (sin prueba) no entra acá → su crédito sigue por la vía de siempre.
    if (event.type === 'invoice.paid' || event.type === 'invoice.payment_succeeded') {
      await this.consumeTrialConversionCredit(tenant.id, ctx, brand.whiteLabelId).catch((e) =>
        this.logger.warn(`consumeTrialConversionCredit falló: ${(e as Error).message}`),
      );
    }
    return { ok: true, action: 'activated' };
  }

  /**
   * Consume 1 crédito de la marca cuando un negocio que entró por el ENLACE DE
   * PRUEBA de 7 días paga su primer cobro real (conversión de la prueba). El
   * discriminador es que la suscripción de Stripe TUVO prueba (`trial_end`): la
   * compra directa no tiene prueba, así que nunca entra. Idempotente: se consume
   * UNA sola vez (si el negocio ya tiene un CONSUME, no vuelve a cobrar). Salta
   * marcas Clubify/ilimitadas y es race-safe (solo debita si hay crédito).
   */
  private async consumeTrialConversionCredit(
    tenantId: string,
    ctx: StripeCtx,
    whiteLabelId: string,
  ): Promise<void> {
    if (!ctx.trialEnd) return; // sin prueba → compra directa, no aplica
    if (!(ctx.amountUsd && ctx.amountUsd > 0)) return; // solo un cobro REAL (no la factura $0 de la prueba)
    // Idempotencia: se consume en la conversión y nunca más (renovaciones ya no
    // recobran; su crédito, si aplica, va por la vía normal de la marca).
    const yaConsumido = await this.prisma.creditTransaction.findFirst({
      where: { tenantId, type: 'CONSUME', refundedAt: null },
      select: { id: true },
    });
    if (yaConsumido) return;
    const t = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: {
        brandName: true,
        businessType: true,
        infolinkTier: true,
        planPeriodicity: true,
        whiteLabelId: true,
      },
    });
    if (!t || t.whiteLabelId !== whiteLabelId) return;
    const wl = await this.prisma.whiteLabel.findUnique({
      where: { id: whiteLabelId },
      select: { id: true, slug: true, creditsUnlimited: true },
    });
    if (!wl || wl.slug === 'clubify' || wl.creditsUnlimited) return;
    // Opt-in ESTRICTO por marca: solo consume si la marca activó la feature de
    // prueba (tiene su enlace configurado, hoy solo Sellea). Así el resto de las
    // marcas blancas quedan tal cual, aunque una tuviera una suscripción con
    // prueba por otra vía. Ver setBrandTrialConfig / página /prueba.
    const trialCfg = await this.prisma.setting.findFirst({
      where: { key: `landing.trial.checkoutUrl.${wl.slug}` },
      select: { value: true },
    });
    if (!trialCfg || !(trialCfg.value ?? '').trim()) return;
    const cost = cycleCreditCostForTenant(t.businessType, t.infolinkTier, t.planPeriodicity);
    const debit = await this.prisma.whiteLabel.updateMany({
      where: { id: wl.id, creditsAvailable: { gte: cost } },
      data: { creditsAvailable: { decrement: cost }, creditsUsed: { increment: cost } },
    });
    if (debit.count === 0) {
      this.logger.warn(
        `consumeTrialConversionCredit: ${wl.slug} sin créditos para ${t.brandName} (${tenantId})`,
      );
      return;
    }
    await this.prisma.creditTransaction.create({
      data: {
        whiteLabelId: wl.id,
        type: 'CONSUME',
        amount: -cost,
        tenantId,
        note: `Prueba 7 días convertida (cobro Stripe) · ${t.brandName} · ${cost} créd`,
      },
    });
    this.logger.log(
      `consumeTrialConversionCredit: -${cost} créd a ${wl.slug} por conversión de prueba de ${t.brandName} (${tenantId})`,
    );
  }

  private async onPaymentFailed(brand: BrandCtx, event: Stripe.Event) {
    const ctx = await this.extractCtx(brand, event);
    const tenant = await this.findTenant(brand.whiteLabelId, ctx);
    if (!tenant) return { ok: true, action: 'tenant_not_found' };
    await this.prisma.tenant.update({
      where: { id: tenant.id },
      data: {
        failedPaymentCount: { increment: 1 },
        lastPaymentAttemptAt: new Date(),
        // Ancla INMUTABLE de la gracia (solo el 1er fallo). Ver hotmart.service.
        firstFailedAt: tenant.firstFailedAt ?? new Date(),
      },
    });
    await this.billing.auditLifecycle('subscription.payment_failed', tenant.id, { gateway: 'STRIPE' });
    this.smsTemplates
      .render('payment_failed', { brandName: tenant.brandName }, tenant.id)
      .then((msg) => this.notifyOwner(tenant.id, tenant.brandName, msg))
      .catch(() => null);
    this.brandEmail
      .sendTemplate({ templateId: 'email_payment_failed', tenantId: tenant.id })
      .catch(() => null);
    return { ok: true, action: 'payment_failed' };
  }

  private async onSubscriptionCancelled(brand: BrandCtx, event: Stripe.Event) {
    const ctx = await this.extractCtx(brand, event);
    const tenant = await this.findTenant(brand.whiteLabelId, ctx);
    if (!tenant) return { ok: true, action: 'tenant_not_found' };
    // Freemium: InfoLink PRO cancelado → vuelve a FREE, no se suspende.
    if (await this.downgradeInfolinkPro(tenant.id)) {
      return { ok: true, action: 'infolink_downgraded_to_free' };
    }
    await this.prisma.tenant.update({
      where: { id: tenant.id },
      data: { status: 'SUSPENDED', suspendedAt: new Date() },
    });
    // PDF 1256 §2/§8: liberar crédito a la marca + auditar.
    await this.billing.releaseBrandCreditOnSuspend(tenant.id, 'stripe_cancelled').catch(() => null);
    await this.billing.auditLifecycle('subscription.suspended', tenant.id, { gateway: 'STRIPE', reason: 'cancelled' });
    // Stage 4 (PDF734): si la marca activó "Cancelación" (admin_cancellation),
    // se envía ese texto; si no, el aviso de pausa de siempre. OFF por defecto.
    const sentAdmin = await isBrandTemplateSendEnabled(
      this.prisma,
      'admin_cancellation',
      brand.whiteLabelId,
    )
      .then(async (enabled) => {
        if (!enabled) return false;
        const msg = await this.smsTemplates.render(
          'admin_cancellation',
          { brandName: tenant.brandName },
          tenant.id,
        );
        if (!msg) return false;
        await this.notifyOwner(tenant.id, tenant.brandName, msg);
        return true;
      })
      .catch(() => false);
    if (!sentAdmin) {
      this.smsTemplates
        .render('account_paused', { brandName: tenant.brandName }, tenant.id)
        .then((msg) => this.notifyOwner(tenant.id, tenant.brandName, msg))
        .catch(() => null);
    }
    // El correo va ON por defecto, a diferencia del SMS admin_*: su gate es que
    // la marca tenga con qué enviar.
    this.brandEmail
      .sendTemplate({ templateId: 'email_cancellation', tenantId: tenant.id })
      .catch(() => null);
    return { ok: true, action: 'suspended' };
  }

  /** Contexto mínimo desde un objeto Subscription de Stripe (para los eventos
   *  customer.subscription.*), donde el payload NO es una invoice. */
  private ctxFromSubscription(event: Stripe.Event): StripeCtx {
    const sub = event.data.object as any;
    return {
      email: null,
      customerId: typeof sub.customer === 'string' ? sub.customer : null,
      subscriptionId: typeof sub.id === 'string' ? sub.id : null,
      priceId: sub.items?.data?.[0]?.price?.id ?? null,
      nextCharge:
        typeof sub.current_period_end === 'number'
          ? new Date(sub.current_period_end * 1000)
          : null,
      amountUsd: null,
      paidAt:
        typeof event.created === 'number'
          ? new Date(event.created * 1000)
          : null,
      // Eventos de suscripcion (cancelada, reanudada): no son un cobro, no
      // generan comision y por tanto no necesitan clave de deduplicacion.
      transaccionId: typeof event.id === 'string' ? event.id : null,
      trialEnd:
        typeof sub.trial_end === 'number' ? new Date(sub.trial_end * 1000) : null,
    };
  }

  /** invoice.upcoming (PDF 1256 §3): Stripe avisa que se acerca el cobro.
   *  Sincronizamos la fecha del próximo cobro. Los recordatorios (7/3/1 días)
   *  los emite el cron de billing (ahora multi-marca) para no duplicar. */
  private async onInvoiceUpcoming(brand: BrandCtx, event: Stripe.Event) {
    const ctx = await this.extractCtx(brand, event);
    const tenant = await this.findTenant(brand.whiteLabelId, ctx);
    if (!tenant) return { ok: true, action: 'tenant_not_found' };
    if (ctx.nextCharge) {
      await this.prisma.tenant.update({
        where: { id: tenant.id },
        data: { currentPeriodEnd: ctx.nextCharge },
      });
    }
    this.logger.log(
      `Stripe invoice.upcoming ${brand.slug}/${tenant.brandName} → próximo cobro ${ctx.nextCharge?.toISOString() ?? '?'}`,
    );
    return { ok: true, action: 'upcoming_synced' };
  }

  /** customer.subscription.created/updated (PDF 1256 §3): sincroniza ids +
   *  fecha de próximo cobro. La activación/estado la maneja el flujo de pagos. */
  private async onSubscriptionSynced(brand: BrandCtx, event: Stripe.Event) {
    const ctx = this.ctxFromSubscription(event);
    const tenant = await this.findTenant(brand.whiteLabelId, ctx);
    if (!tenant) return { ok: true, action: 'tenant_not_found' };
    await this.prisma.tenant.update({
      where: { id: tenant.id },
      data: {
        stripeSubscriptionId: ctx.subscriptionId ?? tenant.stripeSubscriptionId,
        stripeCustomerId: ctx.customerId ?? tenant.stripeCustomerId,
        ...(ctx.nextCharge ? { currentPeriodEnd: ctx.nextCharge } : {}),
      },
    });
    return { ok: true, action: 'subscription_synced' };
  }

  /** customer.subscription.paused (PDF 1256 §3): pausa la cuenta + avisa. */
  private async onSubscriptionPaused(brand: BrandCtx, event: Stripe.Event) {
    const ctx = this.ctxFromSubscription(event);
    const tenant = await this.findTenant(brand.whiteLabelId, ctx);
    if (!tenant) return { ok: true, action: 'tenant_not_found' };
    // Freemium: InfoLink PRO pausado → vuelve a FREE, no se suspende.
    if (await this.downgradeInfolinkPro(tenant.id)) {
      return { ok: true, action: 'infolink_downgraded_to_free' };
    }
    if (tenant.status !== 'SUSPENDED') {
      await this.prisma.tenant.update({
        where: { id: tenant.id },
        data: { status: 'SUSPENDED', suspendedAt: new Date() },
      });
      await this.billing.releaseBrandCreditOnSuspend(tenant.id, 'stripe_paused').catch(() => null);
      await this.billing.auditLifecycle('subscription.suspended', tenant.id, { gateway: 'STRIPE', reason: 'paused' });
      this.smsTemplates
        .render('account_paused', { brandName: tenant.brandName }, tenant.id)
        .then((msg) => this.notifyOwner(tenant.id, tenant.brandName, msg))
        .catch(() => null);
      this.brandEmail
        .sendTemplate({ templateId: 'email_account_paused', tenantId: tenant.id })
        .catch(() => null);
    }
    return { ok: true, action: 'paused' };
  }

  /** customer.subscription.resumed (PDF 1256 §3): reactiva la cuenta + avisa. */
  private async onSubscriptionResumed(brand: BrandCtx, event: Stripe.Event) {
    const ctx = this.ctxFromSubscription(event);
    const tenant = await this.findTenant(brand.whiteLabelId, ctx);
    if (!tenant) return { ok: true, action: 'tenant_not_found' };
    await this.prisma.tenant.update({
      where: { id: tenant.id },
      data: {
        status: 'ACTIVE',
        suspendedAt: null,
        failedPaymentCount: 0,
        firstFailedAt: null,
        ...(ctx.nextCharge ? { currentPeriodEnd: ctx.nextCharge } : {}),
      },
    });
    // Fase D: reactivación (resumed) → business.activated.
    if (tenant.status !== 'ACTIVE') {
      void this.onboardingWebhook.emitBusinessActivated(tenant.id);
    }
    await this.billing.clearCreditRelease(tenant.id);
    await this.billing.auditLifecycle('subscription.reactivated', tenant.id, { gateway: 'STRIPE', reason: 'resumed' });
    this.smsTemplates
      .render('account_reactivated', { brandName: tenant.brandName }, tenant.id)
      .then((msg) => this.notifyOwner(tenant.id, tenant.brandName, msg))
      .catch(() => null);
    return { ok: true, action: 'resumed' };
  }

  // ── Reembolso / disputa / contracargo ───────────────────────────

  /**
   * Aviso administrativo (admin_*) al dueño SOLO si la marca lo activó en su
   * panel de Automatizaciones. OFF por defecto, igual que en la vía Hotmart.
   */
  private async maybeSendAdminNotice(
    whiteLabelId: string,
    tenant: { id: string; brandName: string },
    templateId: string,
  ): Promise<boolean> {
    try {
      const enabled = await isBrandTemplateSendEnabled(
        this.prisma,
        templateId,
        whiteLabelId,
      );
      if (!enabled) return false;
      const msg = await this.smsTemplates.render(
        templateId,
        { brandName: tenant.brandName },
        tenant.id,
      );
      if (!msg) return false;
      await this.notifyOwner(tenant.id, tenant.brandName, msg);
      return true;
    } catch (e) {
      this.logger.warn(
        `maybeSendAdminNotice(${templateId}) falló: ${(e as Error).message}`,
      );
      return false;
    }
  }

  /**
   * Tenant de un evento `charge.*` / `charge.dispute.*`. En los `dispute.*` el
   * objeto del evento es la Disputa, que no trae `customer`: hay que subir al
   * Charge para resolverlo. Último recurso, el email del recibo.
   */
  private async findTenantFromCharge(brand: BrandCtx, event: Stripe.Event) {
    const obj = event.data.object as any;
    let charge: any = obj;
    if (event.type.startsWith('charge.dispute.')) {
      const chargeId = typeof obj.charge === 'string' ? obj.charge : null;
      if (!chargeId) return null;
      charge = await brand.client.charges
        .retrieve(chargeId)
        .catch((e: Error) => {
          this.logger.warn(`retrieve charge ${chargeId} falló: ${e.message}`);
          return null;
        });
      if (!charge) return null;
    }
    return this.findTenant(brand.whiteLabelId, {
      email: charge.billing_details?.email ?? charge.receipt_email ?? null,
      customerId: typeof charge.customer === 'string' ? charge.customer : null,
      subscriptionId: null,
      priceId: null,
      nextCharge: null,
      amountUsd: null,
      // Solo BÚSQUEDA del tenant: findTenant no lee paidAt ni transaccionId
      // (fijan purchasedAt y deduplican comisiones en el camino de cobro, no
      // acá). null como el resto.
      paidAt: null,
      transaccionId: null,
      trialEnd: null,
    });
  }

  /**
   * `charge.refunded` — reembolso. Espeja PURCHASE_REFUNDED de Hotmart.
   * Solo reembolsos TOTALES: uno parcial no corta el servicio, y decirle al
   * negocio que su cuenta quedó suspendida sería falso.
   */
  private async onChargeRefunded(brand: BrandCtx, event: Stripe.Event) {
    const charge = event.data.object as any;
    const full =
      charge.refunded === true ||
      (typeof charge.amount === 'number' &&
        typeof charge.amount_refunded === 'number' &&
        charge.amount_refunded >= charge.amount);
    if (!full) {
      this.logger.log(
        `Reembolso parcial en ${charge.id} — sin suspensión ni aviso`,
      );
      return { ok: true, action: 'partial_refund' };
    }
    const tenant = await this.findTenantFromCharge(brand, event);
    if (!tenant) return { ok: true, action: 'tenant_not_found' };
    await this.prisma.tenant.update({
      where: { id: tenant.id },
      data: { status: 'SUSPENDED', suspendedAt: new Date() },
    });
    this.maybeSendAdminNotice(
      brand.whiteLabelId,
      tenant,
      'admin_refunded',
    ).catch(() => null);
    this.brandEmail
      .sendTemplate({ templateId: 'email_refunded', tenantId: tenant.id })
      .catch(() => null);
    return { ok: true, action: 'refunded' };
  }

  /**
   * `charge.dispute.created` — disputa abierta. NO suspendemos: el dinero queda
   * retenido pero el servicio sigue mientras el banco decide. Si se pierde
   * llega `charge.dispute.closed` con status `lost` y ahí sí se corta.
   */
  private async onDisputeCreated(brand: BrandCtx, event: Stripe.Event) {
    const tenant = await this.findTenantFromCharge(brand, event);
    if (!tenant) return { ok: true, action: 'tenant_not_found' };
    this.maybeSendAdminNotice(
      brand.whiteLabelId,
      tenant,
      'admin_protest',
    ).catch(() => null);
    this.brandEmail
      .sendTemplate({ templateId: 'email_dispute', tenantId: tenant.id })
      .catch(() => null);
    return { ok: true, action: 'dispute_opened' };
  }

  /**
   * `charge.dispute.closed` — solo actuamos si se PERDIÓ: eso es un contracargo
   * real. Si se ganó o se retiró, el servicio nunca se interrumpió.
   */
  private async onDisputeClosed(brand: BrandCtx, event: Stripe.Event) {
    const dispute = event.data.object as any;
    if (dispute.status !== 'lost') {
      return { ok: true, action: 'dispute_not_lost' };
    }
    const tenant = await this.findTenantFromCharge(brand, event);
    if (!tenant) return { ok: true, action: 'tenant_not_found' };
    await this.prisma.tenant.update({
      where: { id: tenant.id },
      data: { status: 'SUSPENDED', suspendedAt: new Date() },
    });
    this.maybeSendAdminNotice(
      brand.whiteLabelId,
      tenant,
      'admin_chargeback',
    ).catch(() => null);
    this.brandEmail
      .sendTemplate({ templateId: 'email_chargeback', tenantId: tenant.id })
      .catch(() => null);
    return { ok: true, action: 'chargeback' };
  }

  // ── Activación ──────────────────────────────────────────────────────────

  private async activate(
    tenant: { id: string; brandName: string; status: string; planPeriodicity: string | null; stripeCustomerId: string | null; stripeSubscriptionId: string | null; currentPeriodEnd: Date | null },
    ctx: StripeCtx,
    whiteLabelId: string,
  ) {
    const wasSuspended = tenant.status === 'SUSPENDED';
    const now = new Date();
    // PRUEBA DE 7 DÍAS (enlace de Sellea): mientras Stripe tenga la suscripción
    // en prueba (`trial_end` en el futuro), el negocio queda en TRIAL con
    // vencimiento = fin de la prueba, SIN cobrar ni consumir crédito. El día 7
    // Stripe cobra (invoice con monto>0) → `trial_end` ya pasó → esta misma
    // función lo detecta como NO-prueba → pasa a ACTIVE y ahí sí se consume el
    // crédito (consumeTrialConversionCredit) y se generan comisiones.
    const inTrial = !!ctx.trialEnd && ctx.trialEnd.getTime() > now.getTime();
    // Próximo cobro: Stripe es la fuente. Fallback (primer pago sin fecha) →
    // periodicidad del link de pago que matchea el priceId. En prueba NO usamos
    // el fallback mensual: la fecha que vale es el fin de la prueba (7 días).
    let nextCharge = ctx.nextCharge;
    if (!inTrial && !nextCharge && !tenant.currentPeriodEnd) {
      const periodicity = await this.resolvePeriodicity(whiteLabelId, ctx.priceId, tenant.planPeriodicity);
      nextCharge = addPlanPeriod(now, periodicity);
    }
    // En prueba, la fecha que se muestra y se guarda es el fin de la prueba
    // (cuándo llega el primer cobro), no un período mensual.
    const periodEnd = inTrial ? ctx.trialEnd : nextCharge;
    // FIX PDF123 (cobro duplicado): si el webhook se re-procesa para el MISMO
    // período (Stripe puede reintentar/duplicar), no reenviamos "Pago recibido".
    // Un período nuevo (renovación) trae otra fecha → sí notifica.
    const alreadyConfirmedPeriod =
      !!periodEnd &&
      !!tenant.currentPeriodEnd &&
      periodEnd.getTime() === tenant.currentPeriodEnd.getTime();
    // PDF Soft 10: fecha real de compra — set-once en la 1ª activación (nunca se
    // pisa en renovaciones). Preferimos el timestamp real del evento (ctx.paidAt).
    const curPurchase = await this.prisma.tenant.findUnique({
      where: { id: tenant.id },
      select: { purchasedAt: true },
    });
    // Freemium Sellea: si el link de pago pagado (por priceId) otorga un
    // producto, lo aplicamos al confirmar el pago (server-side, nunca desde el
    // cliente). INFOLINK_PRO → tier=PRO; FULL → Negocio Completo. Pagos normales
    // (sin productKey) no cambian tipo/nivel. Ver project_sellea_infolinks_freemium.
    const entitlement = await this.resolveEntitlementPatch(whiteLabelId, ctx.priceId);
    await this.prisma.tenant.update({
      where: { id: tenant.id },
      data: {
        // En prueba queda TRIAL (con vencimiento a 7 días); el cobro real del
        // día 7 lo pasa a ACTIVE.
        status: inTrial ? 'TRIAL' : 'ACTIVE',
        ...entitlement,
        // 2026-07-31: monto crudo → auditoría, no a la base de comisiones. En
        // prueba no hubo cobro (monto $0), así que no tocamos el último monto.
        ...(!inTrial && ctx.amountUsd != null ? { lastPaymentAmountUsd: ctx.amountUsd } : {}),
        ...(periodEnd ? { currentPeriodEnd: periodEnd } : {}),
        // Solo hay cobro real fuera de la prueba. Durante la prueba la tarjeta
        // está anclada pero no se cobró → no marcamos lastChargeAt.
        ...(inTrial ? {} : { lastChargeAt: now }),
        ...(curPurchase?.purchasedAt
          ? {}
          : { purchasedAt: ctx.paidAt ?? now }),
        stripeCustomerId: ctx.customerId ?? tenant.stripeCustomerId,
        stripeSubscriptionId: ctx.subscriptionId ?? tenant.stripeSubscriptionId,
        failedPaymentCount: 0,
        // Pago/activación confirmada → limpiar el ancla de mora del ciclo.
        firstFailedAt: null,
        lastPaymentAttemptAt: now,
        suspendedAt: null,
        // En prueba, guardamos cuándo termina (día 7) para el panel y los
        // recordatorios; al convertir a ACTIVE se limpia.
        trialEndsAt: inTrial ? ctx.trialEnd : null,
        // Los SEIS campos de dedup, no tres. Faltaban los pre-avisos, asi que
        // un negocio que renovaba no volvia a recibir el aviso de 7 dias, ni
        // el de 3, ni el del dia — y el fallo es mudo. Ver [[clubify-cobros-trampas]].
        paymentReminderSentFor: null,
        paymentFailureNoticeSentAt: null,
        pausePendingNoticeSentAt: null,
        preReminder7dSentFor: null,
        preReminder3dSentFor: null,
        preReminderTodaySentFor: null,
      },
    });

    // CONTABILIDAD (Fase 1): registrar el ingreso real de este cobro con su
    // desglose bruto/fee/impuesto/neto (histórico). El servicio salta los $0
    // (día 0 de la prueba) y deduplica por transacción. Best-effort.
    void this.incomeRecord.record({
      gateway: 'STRIPE',
      externalTxId: ctx.transaccionId,
      tenantId: tenant.id,
      whiteLabelId,
      brandName: tenant.brandName,
      planPeriodicity: tenant.planPeriodicity,
      currency: 'USD',
      grossUsd: ctx.amountUsd,
      isFirstPayment: !tenant.stripeSubscriptionId,
      saleDate: ctx.paidAt ?? now,
    });

    // Comisiones del referido. Best-effort: si falla, el cobro NO se rompe —
    // el negocio queda activo igual y la comision se puede reconciliar.
    // NO durante la prueba: en el día 0 no entró dinero; la comisión se genera
    // en el cobro real del día 7 (cuando esta función corre con inTrial=false).
    if (!inTrial) {
      await this.hotmart
        .generarComisionesDeCobro({
          tenantId: tenant.id,
          // Stripe manda el monto en la moneda del cobro; la base de comision
          // la resuelve el generador desde el plan, no desde aqui.
          montoCanonicoUsd: null,
          transaccionId: ctx.transaccionId,
        })
        .catch((e) =>
          this.logger.warn(
            `comisiones Stripe tenant=${tenant.id}: ${(e as Error).message}`,
          ),
        );
    }

    // Si el pago lo pasó a Negocio Completo, invalidamos el cache del
    // InfoLinkOnlyGuard para que los módulos se desbloqueen sin esperar el TTL.
    if ((entitlement as { businessType?: string }).businessType === 'FULL') {
      invalidateBusinessTypeCache(tenant.id);
    }
    // PDF 1256 §8: auditar + limpiar la marca de liberación de crédito (permite
    // liberar de nuevo si el negocio se vuelve a suspender en un ciclo futuro).
    await this.billing.clearCreditRelease(tenant.id);
    await this.billing.auditLifecycle(
      wasSuspended ? 'subscription.reactivated' : 'subscription.payment_succeeded',
      tenant.id,
      { gateway: 'STRIPE', amountUsd: ctx.amountUsd ?? null },
    );
    // Si venía SUSPENDED → "cuenta reactivada"; en prueba → "prueba activa, se
    // cobra en 7 días"; si no → "pago confirmado".
    if (wasSuspended) {
      this.smsTemplates
        .render('account_reactivated', { brandName: tenant.brandName }, tenant.id)
        .then((msg) => this.notifyOwner(tenant.id, tenant.brandName, msg))
        .catch(() => null);
    } else if (inTrial && ctx.trialEnd && !alreadyConfirmedPeriod) {
      // "En N días (fecha) se hace el primer cobro" — NO "próximo cobro: <mes>".
      const trialDays = Math.max(
        1,
        Math.ceil((ctx.trialEnd.getTime() - now.getTime()) / 86_400_000),
      );
      this.smsTemplates
        .render(
          'trial_started',
          {
            brandName: tenant.brandName,
            trialDays: String(trialDays),
            chargeDate: fmtSmsDate(ctx.trialEnd),
          },
          tenant.id,
        )
        .then((msg) => this.notifyOwner(tenant.id, tenant.brandName, msg))
        .catch(() => null);
    } else if (!alreadyConfirmedPeriod) {
      const nextChargeInfo = periodEnd ? ` Próximo cobro: ${fmtSmsDate(periodEnd)}.` : '';
      this.smsTemplates
        .render('payment_confirmed', { brandName: tenant.brandName, nextChargeInfo }, tenant.id)
        .then((msg) => this.notifyOwner(tenant.id, tenant.brandName, msg))
        .catch(() => null);
    }
    // CORREO del mismo hecho: primera compra → "panel listo"; cuenta que
    // revivió → "reactivada"; renovación → "pago confirmado". Sin suscripción
    // previa = es la primera compra de este negocio.
    if (wasSuspended || !alreadyConfirmedPeriod) {
      this.brandEmail
        .sendTemplate({
          templateId: wasSuspended
            ? 'email_account_reactivated'
            : !tenant.stripeSubscriptionId
              ? 'email_panel_ready'
              : 'email_payment_confirmed',
          tenantId: tenant.id,
          vars: { nextChargeDate: periodEnd ? fmtEmailDate(periodEnd) : '' },
        })
        .catch(() => null);
    }
    // Fase D: activación REAL (no prueba, no renovación) → business.activated.
    // En la prueba el negocio aún no es una cuenta activada; el webhook de
    // onboarding sale cuando el cobro del día 7 lo pasa a ACTIVE.
    if (!inTrial && tenant.status !== 'ACTIVE') {
      void this.onboardingWebhook.emitBusinessActivated(tenant.id);
    }
  }

  /** Activa un tenant ya conocido por id — lo usa /auth/signup al consumir un
   *  PendingStripePayment (flujo pago → datos). */
  async activateForTenant(tenantId: string, event: Stripe.Event, brand: BrandCtx) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true, brandName: true, status: true, planPeriodicity: true, stripeCustomerId: true, stripeSubscriptionId: true, currentPeriodEnd: true },
    });
    if (!tenant) return false;
    const ctx = await this.extractCtx(brand, event);
    await this.activate(tenant, ctx, brand.whiteLabelId);
    return true;
  }

  /** Consume un PendingStripePayment por email al crear la cuenta. Lo invoca
   *  /auth/signup. Match por email + whiteLabelId del tenant recién creado. */
  async consumePendingForTenant(tenantId: string, email: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true, whiteLabelId: true },
    });
    if (!tenant?.whiteLabelId) return false;
    const e = (email ?? '').trim().toLowerCase();
    if (!e) return false;
    const pending = await this.prisma.pendingStripePayment.findFirst({
      where: { email: e, whiteLabelId: tenant.whiteLabelId, consumedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    if (!pending) return false;
    const brand = await this.loadBrandById(tenant.whiteLabelId);
    if (!brand) return false;
    await this.prisma.pendingStripePayment.update({
      where: { id: pending.id },
      data: { consumedAt: new Date() },
    });
    try {
      await this.activateForTenant(tenantId, pending.rawPayload as unknown as Stripe.Event, brand);
    } catch (err) {
      await this.prisma.pendingStripePayment
        .update({ where: { id: pending.id }, data: { consumedAt: null } })
        .catch(() => undefined);
      throw err;
    }
    this.logger.log(`PendingStripePayment consumido para tenant=${tenantId} (${e})`);
    return true;
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private async loadBrandById(whiteLabelId: string): Promise<BrandCtx | null> {
    const wl = await this.prisma.whiteLabel.findUnique({
      where: { id: whiteLabelId },
      select: { slug: true, status: true },
    });
    if (!wl || wl.status !== 'ACTIVE') return null;
    return this.loadBrand(wl.slug);
  }

  private async storePending(brand: BrandCtx, event: Stripe.Event, ctx: StripeCtx) {
    const email = (ctx.email ?? '').trim().toLowerCase();
    if (!email) return;
    const dup = await this.prisma.pendingStripePayment.findFirst({
      where: { email, whiteLabelId: brand.whiteLabelId, stripeSubscriptionId: ctx.subscriptionId ?? undefined, consumedAt: null },
    });
    if (dup) return;
    await this.prisma.pendingStripePayment.create({
      data: {
        email,
        whiteLabelId: brand.whiteLabelId,
        stripeCustomerId: ctx.customerId,
        stripeSubscriptionId: ctx.subscriptionId,
        stripePriceId: ctx.priceId,
        event: event.type,
        rawPayload: event as unknown as object,
      },
    });
    this.logger.log(`PendingStripePayment guardado para ${email} (${brand.slug})`);

    // Aviso al comprador con el link para crear su cuenta — antes acá no salía
    // NADA y el pago quedaba cobrado sin producto entregado. Idempotencia: la
    // misma compra llega como checkout.session.completed E invoice.paid (y
    // Stripe reintenta webhooks); si otra fila sin consumir de este comprador
    // ya fue avisada (recoveryNotifiedAt), no repetimos el aviso.
    const yaAvisado = await this.prisma.pendingStripePayment.findFirst({
      where: {
        email,
        whiteLabelId: brand.whiteLabelId,
        consumedAt: null,
        recoveryNotifiedAt: { not: null },
      },
      select: { id: true },
    });
    if (yaAvisado) return;
    const buyer = buyerContactOf(event);
    await this.notifyPendingRecovery(brand.whiteLabelId, {
      email,
      name: buyer.name,
      phone: buyer.phone,
    }).catch((e) =>
      this.logger.warn(
        `aviso de compra sin cuenta (Stripe) falló para ${email}: ${(e as Error).message}`,
      ),
    );
  }

  /**
   * Aviso al comprador que pagó sin tener cuenta: correo + WhatsApp/SMS con la
   * identidad de la marca (PendingActivationService) y SMS al equipo. Marca
   * recoveryNotifiedAt solo si algún canal llegó de verdad — si todo falló, el
   * siguiente intento (webhook o reenvío manual) debe volver a intentar.
   */
  private async notifyPendingRecovery(
    whiteLabelId: string | null,
    opts: { email: string; name: string | null; phone: string | null },
  ) {
    const r = await this.pendingActivation.notifyBuyer({
      gateway: 'STRIPE',
      whiteLabelId,
      email: opts.email,
      name: opts.name,
      phone: opts.phone,
    });
    if (r.emailSent || r.channel !== 'none') {
      await this.prisma.pendingStripePayment
        .updateMany({
          where: {
            email: opts.email,
            ...(whiteLabelId ? { whiteLabelId } : {}),
            consumedAt: null,
            recoveryNotifiedAt: null,
          },
          data: { recoveryNotifiedAt: new Date() },
        })
        .catch(() => null);
    }
  }

  /**
   * Reenvía el link de activación a un comprador Stripe con pago pendiente que
   * aún no creó su cuenta. Mismo camino que el aviso automático del webhook —
   * lo usa POST /admin/pending-payments/resend (panel «Pagos sin activar»).
   */
  async resendPendingRecovery(
    email: string,
  ): Promise<{ ok: boolean; found: boolean }> {
    const e = (email ?? '').trim().toLowerCase();
    if (!e) return { ok: false, found: false };
    const pending = await this.prisma.pendingStripePayment.findFirst({
      where: { email: e, consumedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    if (!pending) return { ok: false, found: false };
    const buyer = buyerContactOf(pending.rawPayload);
    await this.notifyPendingRecovery(pending.whiteLabelId, {
      email: pending.email,
      name: buyer.name,
      phone: buyer.phone,
    }).catch(() => null);
    return { ok: true, found: true };
  }

  /** Periodicidad del plan que matchea el priceId (link de pago de la marca). */
  private async resolvePeriodicity(whiteLabelId: string, priceId: string | null, fallback: string | null): Promise<string | null> {
    if (priceId) {
      const link = await this.prisma.whiteLabelPaymentLink.findFirst({
        where: { whiteLabelId, stripePriceId: priceId },
        select: { periodicity: true },
      });
      if (link) return link.periodicity;
    }
    return fallback;
  }

  /**
   * Freemium: qué OTORGA el pago según el link (productKey) que matchea el
   * priceId pagado. Devuelve el patch a aplicar sobre el tenant:
   *   INFOLINK_PRO → { infolinkTier: 'PRO' }        (sube de FREE a PRO)
   *   FULL         → { businessType: 'FULL', infolinkTier: null } (Negocio Completo)
   *   sin productKey / sin priceId → {}             (suscripción normal)
   */
  private async resolveEntitlementPatch(
    whiteLabelId: string,
    priceId: string | null,
  ): Promise<Record<string, unknown>> {
    if (!priceId) return {};
    const link = await this.prisma.whiteLabelPaymentLink.findFirst({
      where: { whiteLabelId, stripePriceId: priceId },
      select: { productKey: true },
    });
    if (link?.productKey === 'INFOLINK_PRO') return { infolinkTier: 'PRO' };
    if (link?.productKey === 'FULL') return { businessType: 'FULL', infolinkTier: null };
    return {};
  }

  /**
   * Freemium: si el tenant es "Solo InfoLink", cancelar/pausar el PRO NO lo
   * suspende — vuelve a FREE y su Infolink público SIGUE VIVO (con publicidad y
   * límites de nuevo). Devuelve true si lo manejó (el caller NO debe suspender);
   * false si es Negocio Completo → sigue el flujo normal de suspensión.
   */
  private async downgradeInfolinkPro(tenantId: string): Promise<boolean> {
    const t = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { businessType: true },
    });
    if (t?.businessType !== 'INFOLINK') return false;
    await this.prisma.tenant.update({
      where: { id: tenantId },
      data: { infolinkTier: 'FREE' },
    });
    this.logger.log(`InfoLink PRO cancelado/pausado → FREE (sigue activo) tenant=${tenantId}`);
    return true;
  }

  /** Resuelve el tenant de la marca por subscription/customer/email. Scopeado
   *  al whiteLabelId — un pago de una marca NUNCA activa el tenant de otra. */
  private async findTenant(whiteLabelId: string, ctx: StripeCtx) {
    const sel = {
      id: true,
      brandName: true,
      status: true,
      planPeriodicity: true,
      stripeCustomerId: true,
      stripeSubscriptionId: true,
      currentPeriodEnd: true,
      firstFailedAt: true,
    };
    if (ctx.subscriptionId) {
      const t = await this.prisma.tenant.findFirst({
        where: { whiteLabelId, stripeSubscriptionId: ctx.subscriptionId },
        select: sel,
      });
      if (t) return t;
    }
    if (ctx.customerId) {
      const t = await this.prisma.tenant.findFirst({
        where: { whiteLabelId, stripeCustomerId: ctx.customerId },
        select: sel,
      });
      if (t) return t;
    }
    if (ctx.email) {
      const owner = await this.prisma.user.findFirst({
        where: {
          email: ctx.email.toLowerCase(),
          role: 'TENANT_OWNER',
          tenantId: { not: null },
          tenant: { whiteLabelId },
        },
        select: { tenantId: true },
      });
      if (owner?.tenantId) {
        return this.prisma.tenant.findUnique({ where: { id: owner.tenantId }, select: sel });
      }
    }
    return null;
  }

  /** SMS best-effort al dueño (mismo resolver de billing que Hotmart). */
  private async notifyOwner(tenantId: string, brandName: string, message: string) {
    const target = await this.billing.resolveBillingTarget(tenantId);
    if (!target) return;
    const r = await this.growBusiness
      .sendSmsWithCreds(target.creds, target.phone, message)
      .catch((e) => ({ ok: false as const, message: e?.message }));
    if (r.ok) this.logger.log(`SMS Stripe enviado a ${brandName} (${target.phone})`);
    else this.logger.warn(`SMS Stripe falló para ${brandName}: ${r.message ?? 'unknown'}`);
  }
}
