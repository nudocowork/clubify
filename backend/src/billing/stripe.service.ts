import { Injectable, Logger } from '@nestjs/common';
import Stripe from 'stripe';
import { PrismaService } from '../common/prisma/prisma.service';
import { GrowBusinessService } from '../integrations/grow-business.service';
import { BillingService } from './billing.service';
import { SmsTemplatesService } from './sms-templates.service';
import { BrandEmailService } from '../email/brand-email.service';
import { fmtEmailDate } from '../email/brand-email-templates';
import { isBrandTemplateSendEnabled } from '../integrations/brand-message-templates';
import { addPlanPeriod } from '../common/plan-period';
import { fmtSmsDate } from './sms-templates';
import { decryptSecret } from '../common/crypto/secret-box';
import { OnboardingWebhookService } from '../onboarding-sync/onboarding-webhook.service';

/** Contexto extraído de un evento de pago Stripe, normalizado. */
type StripeCtx = {
  email: string | null;
  customerId: string | null;
  subscriptionId: string | null;
  priceId: string | null;
  nextCharge: Date | null;
  amountUsd: number | null;
};

type BrandCtx = {
  whiteLabelId: string;
  slug: string;
  client: Stripe;
  webhookSecret: string;
};

/**
 * Pasarela Stripe por marca blanca (cuenta PROPIA por marca). El cobro se hace
 * con Stripe Payment Links (la marca pega su link en el config); nosotros solo
 * procesamos el webhook firmado con SU webhookSecret. Espeja el flujo de
 * Hotmart (activación, pending "pago → datos", SMS, idempotencia) pero SIN
 * comisiones de referido (eso es del sistema de afiliados de Clubify, no de
 * las marcas blancas Stripe).
 */
@Injectable()
export class StripeService {
  private readonly logger = new Logger(StripeService.name);

  constructor(
    private prisma: PrismaService,
    private billing: BillingService,
    private growBusiness: GrowBusinessService,
    private smsTemplates: SmsTemplatesService,
    private brandEmail: BrandEmailService,
    private onboardingWebhook: OnboardingWebhookService,
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
        priceId = sub.items?.data?.[0]?.price?.id ?? priceId;
        if (!customerId && typeof sub.customer === 'string') customerId = sub.customer;
      } catch (e) {
        this.logger.warn(`retrieve subscription ${subscriptionId} falló: ${(e as Error).message}`);
      }
    }
    return { email, customerId, subscriptionId, priceId, nextCharge, amountUsd };
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
    return { ok: true, action: 'activated' };
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
    // Próximo cobro: Stripe es la fuente. Fallback (primer pago sin fecha) →
    // periodicidad del link de pago que matchea el priceId.
    let nextCharge = ctx.nextCharge;
    if (!nextCharge && !tenant.currentPeriodEnd) {
      const periodicity = await this.resolvePeriodicity(whiteLabelId, ctx.priceId, tenant.planPeriodicity);
      nextCharge = addPlanPeriod(new Date(), periodicity);
    }
    // FIX PDF123 (cobro duplicado): si el webhook se re-procesa para el MISMO
    // período (Stripe puede reintentar/duplicar), no reenviamos "Pago recibido".
    // Un período nuevo (renovación) trae otra fecha → sí notifica.
    const alreadyConfirmedPeriod =
      !!nextCharge &&
      !!tenant.currentPeriodEnd &&
      nextCharge.getTime() === tenant.currentPeriodEnd.getTime();
    await this.prisma.tenant.update({
      where: { id: tenant.id },
      data: {
        status: 'ACTIVE',
        // 2026-07-31: monto crudo → auditoría, no a la base de comisiones.
        ...(ctx.amountUsd != null ? { lastPaymentAmountUsd: ctx.amountUsd } : {}),
        ...(nextCharge ? { currentPeriodEnd: nextCharge } : {}),
        lastChargeAt: new Date(),
        stripeCustomerId: ctx.customerId ?? tenant.stripeCustomerId,
        stripeSubscriptionId: ctx.subscriptionId ?? tenant.stripeSubscriptionId,
        failedPaymentCount: 0,
        lastPaymentAttemptAt: new Date(),
        suspendedAt: null,
        trialEndsAt: null,
        paymentReminderSentFor: null,
        paymentFailureNoticeSentAt: null,
        pausePendingNoticeSentAt: null,
      },
    });
    // PDF 1256 §8: auditar + limpiar la marca de liberación de crédito (permite
    // liberar de nuevo si el negocio se vuelve a suspender en un ciclo futuro).
    await this.billing.clearCreditRelease(tenant.id);
    await this.billing.auditLifecycle(
      wasSuspended ? 'subscription.reactivated' : 'subscription.payment_succeeded',
      tenant.id,
      { gateway: 'STRIPE', amountUsd: ctx.amountUsd ?? null },
    );
    // Si venía SUSPENDED → "cuenta reactivada"; si no → "pago confirmado".
    if (wasSuspended) {
      this.smsTemplates
        .render('account_reactivated', { brandName: tenant.brandName }, tenant.id)
        .then((msg) => this.notifyOwner(tenant.id, tenant.brandName, msg))
        .catch(() => null);
    } else if (!alreadyConfirmedPeriod) {
      const nextChargeInfo = nextCharge ? ` Próximo cobro: ${fmtSmsDate(nextCharge)}.` : '';
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
          vars: { nextChargeDate: nextCharge ? fmtEmailDate(nextCharge) : '' },
        })
        .catch(() => null);
    }
    // Fase D: primer pago o reactivación (no renovaciones) → business.activated.
    if (tenant.status !== 'ACTIVE') {
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
