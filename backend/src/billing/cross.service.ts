import { Injectable, Logger } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'crypto';
import { PrismaService } from '../common/prisma/prisma.service';
import { GrowBusinessService } from '../integrations/grow-business.service';
import { BillingService } from './billing.service';
import { SmsTemplatesService } from './sms-templates.service';
import { addPlanPeriod } from '../common/plan-period';
import { fmtSmsDate } from './sms-templates';
import { decryptSecret } from '../common/crypto/secret-box';
import { OnboardingWebhookService } from '../onboarding-sync/onboarding-webhook.service';
import {
  CreateCheckoutInput,
  CheckoutResult,
  NormalizedPaymentStatus,
  NormalizedWebhookEvent,
  PaymentProvider,
} from './payment-provider.interface';

/** Credenciales + contexto de una marca con pasarela CROSS. */
type CrossEnv = 'sandbox' | 'production' | 'dev';
type CrossBrand = {
  whiteLabelId: string;
  slug: string;
  apiKey: string;
  companyId: string;
  /** Nombre del cliente/empresa registrado en Cross (meta.companyName). */
  companyName: string;
  /** Método de pago por defecto (card | pse | …). */
  paymentMethod: string;
  webhookSecret: string;
  environment: CrossEnv;
  baseUrl: string;
};

// URLs base por ambiente (según el panel de Cross). Sandbox y Desarrollo son
// DISTINTOS: sandbox = api-sandbox; desarrollo = api-dev con sufijo /dev.
const CROSS_BASE: Record<CrossEnv, string> = {
  sandbox: 'https://api-sandbox.crosspaysolutions.app',
  production: 'https://api.crosspaysolutions.app',
  dev: 'https://api-dev.crosspaysolutions.app/dev',
} as const;

/**
 * Pasarela Cross (CrossPay Solutions) — API-driven: creamos el cargo vía API
 * (`POST /payments/crosspay/charges`) y obtenemos un `link` de pago; el estado
 * final llega por webhook (`transaction.status_updated`) firmado con HMAC-SHA256.
 *
 * Implementa la interfaz `PaymentProvider` (semilla del Payment Engine).
 * Reutiliza los helpers compartidos de activación (`emitBusinessActivated`,
 * `auditLifecycle`, `clearCreditRelease`) igual que Hotmart y Stripe — NO
 * duplica la lógica de negocio. NO toca Hotmart ni Stripe.
 */
@Injectable()
export class CrossService implements PaymentProvider {
  readonly gateway = 'CROSS' as const;
  private readonly logger = new Logger(CrossService.name);

  constructor(
    private prisma: PrismaService,
    private billing: BillingService,
    private growBusiness: GrowBusinessService,
    private smsTemplates: SmsTemplatesService,
    private onboardingWebhook: OnboardingWebhookService,
  ) {}

  // ── Carga de marca / credenciales ─────────────────────────────────────────

  /**
   * Carga las creds Cross de una marca por slug. ADITIVO: las lee de
   * `paymentConfig.cross` (sub-objeto) si existe — así una marca puede tener
   * Cross configurado SIN cambiar su `paymentGateway` (p.ej. Clubify sigue con
   * Hotmart intacto). Como fallback, si la marca es 100% CROSS, usa el config
   * plano. Null si no hay creds Cross (la presencia de creds es el opt-in).
   */
  private async loadBrand(slug: string): Promise<CrossBrand | null> {
    const s = (slug ?? '').trim().toLowerCase();
    if (!s) return null;
    const wl = await this.prisma.whiteLabel.findFirst({
      where: { slug: s, status: 'ACTIVE' },
      select: { id: true, slug: true, paymentGateway: true, paymentConfig: true },
    });
    if (!wl) return null;
    return this.buildBrand(wl.id, wl.slug, wl.paymentConfig, wl.paymentGateway);
  }

  private async loadBrandById(whiteLabelId: string): Promise<CrossBrand | null> {
    const wl = await this.prisma.whiteLabel.findUnique({
      where: { id: whiteLabelId },
      select: { id: true, slug: true, status: true, paymentGateway: true, paymentConfig: true },
    });
    if (!wl || wl.status !== 'ACTIVE') return null;
    return this.buildBrand(wl.id, wl.slug, wl.paymentConfig, wl.paymentGateway);
  }

  private buildBrand(
    whiteLabelId: string,
    slug: string,
    paymentConfig: unknown,
    paymentGateway?: string,
  ): CrossBrand | null {
    const root = (paymentConfig as Record<string, any>) || {};
    // Slot dedicado `cross` (aditivo) > config plano si la marca es 100% CROSS.
    const cfg: Record<string, any> =
      root.cross && typeof root.cross === 'object'
        ? root.cross
        : paymentGateway === 'CROSS'
        ? root
        : {};
    if (!cfg.apiKey || !cfg.companyId) return null;
    let apiKey: string;
    // webhookSecret es OPCIONAL: sin él se puede crear el cargo (test), pero la
    // verificación de webhook fallará hasta configurarlo.
    let webhookSecret = '';
    try {
      apiKey = decryptSecret(cfg.apiKey);
      if (cfg.webhookSecret) webhookSecret = decryptSecret(cfg.webhookSecret);
    } catch {
      return null;
    }
    const envRaw = String(cfg.environment || 'sandbox').trim().toLowerCase();
    const environment: CrossEnv =
      envRaw === 'production' || envRaw === 'prod'
        ? 'production'
        : envRaw === 'dev' || envRaw === 'desarrollo'
        ? 'dev'
        : 'sandbox';
    // Override explícito de baseUrl si la marca lo configuró (sin barra final).
    const baseUrl = (
      typeof cfg.baseUrl === 'string' && cfg.baseUrl.trim()
        ? cfg.baseUrl.trim()
        : CROSS_BASE[environment]
    ).replace(/\/+$/, '');
    return {
      whiteLabelId,
      slug,
      apiKey,
      companyId: String(cfg.companyId),
      companyName: String(cfg.companyName || '').trim(),
      paymentMethod: String(cfg.paymentMethod || 'card').trim(),
      webhookSecret,
      environment,
      baseUrl,
    };
  }

  private authHeaders(brand: CrossBrand): Record<string, string> {
    // Cross documenta Authorization: Bearer + X-API-Key + X-Company-Id. Enviamos
    // los tres (el Bearer usa el apiKey salvo que se confirme un token distinto
    // en el test de sandbox).
    return {
      Authorization: `Bearer ${brand.apiKey}`,
      'X-API-Key': brand.apiKey,
      'X-Company-Id': brand.companyId,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
  }

  // ── Checkout server-side (crear cargo) ────────────────────────────────────

  /**
   * Crea un cobro con tarjeta (API directa) vía `POST /payments/process`.
   * Schema verificado contra la API real de Cross:
   *   { paymentMethod:'card', amount, currency, description, reference,
   *     platform:'Crosspay form', gateway:'crosspay',
   *     customerEmail, customerName,
   *     customer:{ email, name, phone, document },
   *     card:{ number, expMonth, expYear, cvc, holderName },
   *     meta:{ companyName, language } }
   * Respuesta: { success, status, transactionId, redirectUrl?, message }.
   * PCI: los datos de tarjeta se reenvían a Cross y NO se persisten.
   */
  async createCheckout(input: CreateCheckoutInput): Promise<CheckoutResult> {
    const brand = await this.loadBrand(input.brandSlug);
    if (!brand) return { ok: false, message: 'Marca no configurada para Cross' };
    if (!brand.companyName) {
      return { ok: false, message: 'Falta companyName (meta.companyName) en la config Cross de la marca' };
    }
    if (!input.card) {
      return { ok: false, message: 'Faltan los datos de la tarjeta' };
    }
    const currency = input.currency || 'USD';
    const reference = input.reference || `clbf_${Date.now()}`;
    const email = (input.email || '').trim().toLowerCase();
    const name = input.customerName || email || 'Cliente';
    try {
      const res = await fetch(`${brand.baseUrl}/payments/process`, {
        method: 'POST',
        signal: AbortSignal.timeout(25000),
        headers: this.authHeaders(brand),
        body: JSON.stringify({
          paymentMethod: brand.paymentMethod || 'card',
          amount: input.amountUsd,
          currency,
          description: input.description || 'Suscripción',
          reference,
          platform: 'Crosspay form',
          gateway: 'crosspay',
          customerEmail: email,
          customerName: name,
          customer: {
            email,
            name,
            phone: input.phone || '',
            document: input.document || '',
          },
          card: {
            number: input.card.number.replace(/\s/g, ''),
            expMonth: Number(input.card.expMonth),
            expYear: Number(input.card.expYear),
            cvc: input.card.cvc,
            holderName: input.card.holderName || name,
          },
          meta: { companyName: brand.companyName, language: 'es' },
          returnUrl: input.redirectUrl,
        }),
      });
      const text = await res.text().catch(() => '');
      const data = safeJson(text) || {};
      const providerRef = String(
        data?.transactionId ?? data?.id ?? data?.data?.transactionId ?? data?.data?.id ?? '',
      );
      const redirectUrl = String(
        data?.redirectUrl ?? data?.data?.redirectUrl ?? data?.link ?? '',
      );
      const providerStatus = String(data?.status ?? data?.data?.status ?? (res.ok ? 'pending' : 'failed'));
      const status = this.mapStatus(providerStatus);

      if (!res.ok || data?.success === false) {
        this.logger.warn(`Cross /payments/process falló (${brand.slug}) status=${res.status}: ${text.slice(0, 200)}`);
        return { ok: false, providerRef: providerRef || undefined, status, message: data?.message || `Error ${res.status}` };
      }

      // Registro de la transacción (log/panel) + pendiente para el signup.
      if (providerRef) {
        await this.recordTransaction(brand, {
          providerRef,
          email,
          amountUsd: input.amountUsd,
          currency,
          status,
          providerStatus,
          event: 'charge.created',
          tenantId: (input.metadata as any)?.tenantId ?? null,
        });
        await this.storePending(brand, {
          email,
          providerRef,
          amountUsd: input.amountUsd,
          currency,
          raw: { reference, metadata: input.metadata ?? {} },
        });
      }
      return { ok: true, providerRef, redirectUrl, status, message: data?.message };
    } catch (e) {
      this.logger.warn(`Cross createCheckout threw (${brand.slug}): ${(e as Error).message}`);
      return { ok: false, message: 'Error de red al procesar el pago' };
    }
  }

  // ── Webhook: verificación + parseo ────────────────────────────────────────

  /** Verifica la firma HMAC-SHA256 (hex) del RAW body y devuelve el evento
   *  normalizado, o null si la firma no valida / marca no configurada. */
  async verifyAndParseWebhook(
    slug: string,
    rawBody: Buffer,
    headers: Record<string, string | undefined>,
  ): Promise<NormalizedWebhookEvent | null> {
    const brand = await this.loadBrand(slug);
    if (!brand || !rawBody) return null;
    if (!brand.webhookSecret) {
      this.logger.warn(`Cross webhook sin webhookSecret configurado (${slug}) — se ignora`);
      return null;
    }
    const signature = headers['x-crosspay-signature'];
    if (!signature) return null;
    // HMAC-SHA256 hex sobre el RAW body (antes de parsear), comparación en
    // tiempo constante.
    const expected = createHmac('sha256', brand.webhookSecret).update(rawBody).digest('hex');
    if (!safeEqualHex(signature, expected)) {
      this.logger.warn(`Cross firma inválida (${slug})`);
      return null;
    }
    const body = safeJson(rawBody.toString('utf8'));
    if (!body) return null;
    const event = String(body.event ?? headers['x-crosspay-event'] ?? '');
    const providerRef = String(body.id ?? headers['x-crosspay-delivery'] ?? '');
    const providerStatus = String(body.status ?? '');
    if (!providerRef || !providerStatus) return null;
    return {
      event,
      providerRef,
      providerStatus,
      status: this.mapStatus(providerStatus),
    };
  }

  mapStatus(providerStatus: string): NormalizedPaymentStatus {
    switch ((providerStatus || '').toLowerCase()) {
      case 'approved':
      case 'success':
      case 'completed':
      case 'paid':
        return 'APPROVED';
      case 'processing':
        return 'PROCESSING';
      case 'rejected':
      case 'declined':
      case 'failed':
        return 'REJECTED';
      case 'cancel':
      case 'cancelled':
      case 'canceled':
      case 'expired':
        return 'CANCELLED';
      case 'pending':
      default:
        return 'PENDING';
    }
  }

  // ── Webhook: procesamiento ────────────────────────────────────────────────

  /** Procesa un webhook ya verificado. Idempotente por (providerRef + status):
   *  Cross reenvía el MISMO id de transacción al cambiar de estado, así que la
   *  clave incluye el status (para no bloquear la transición pending→approved). */
  async handleEvent(brand: CrossBrand, evt: NormalizedWebhookEvent, startedAt: number) {
    // Idempotencia por (transacción + estado NORMALIZADO): Cross reenvía el
    // mismo id al cambiar de estado, y distintos crudos equivalentes (approved/
    // success/completed) no deben reactivar dos veces.
    const eventId = `${evt.providerRef}:${evt.status}`;
    try {
      await this.prisma.crossWebhookEvent.create({
        data: {
          eventId,
          eventType: evt.event || 'transaction.status_updated',
          whiteLabelId: brand.whiteLabelId,
          status: evt.status,
          payload: evt as unknown as object,
        },
      });
    } catch (e: any) {
      if (e?.code === 'P2002') return { ok: true, action: 'duplicate' };
      this.logger.warn(`crossWebhookEvent claim falló: ${e?.message}`);
    }

    // Actualiza el registro de la transacción (log/panel).
    const processingMs = Math.max(0, Date.now() - startedAt);
    await this.updateTransactionStatus(brand, evt, processingMs);

    if (evt.status !== 'APPROVED') {
      // pending/processing/rejected/cancelled → no se activa la cuenta.
      return { ok: true, action: `status_${evt.status.toLowerCase()}` };
    }

    // Refleja la aprobación en el pendiente (para que un signup posterior active
    // de inmediato en el flujo pago → datos).
    await this.markPendingApproved(evt.providerRef, evt.providerStatus);

    // APPROVED → activar. Resolvemos el tenant por la transacción registrada
    // (tenantId directo si se conocía al crear el cargo) o por el email.
    const txn = await this.prisma.crossTransaction.findUnique({
      where: { providerRef: evt.providerRef },
      select: { tenantId: true, email: true, amountUsd: true },
    });
    const amountUsd = txn?.amountUsd != null ? Number(txn.amountUsd) : null;

    let tenant = txn?.tenantId
      ? await this.getTenant(txn.tenantId)
      : null;
    if (!tenant && txn?.email) {
      tenant = await this.findTenantByEmail(brand.whiteLabelId, txn.email);
    }
    if (!tenant) {
      // Pago aprobado sin cuenta aún → queda el PendingCrossPayment para que el
      // signup lo consuma (flujo pago → datos).
      return { ok: true, action: 'pending_no_account' };
    }
    await this.activate(tenant, { amountUsd }, brand.whiteLabelId);
    return { ok: true, action: 'activated' };
  }

  // ── Activación (reutiliza los helpers compartidos) ────────────────────────

  private async activate(
    tenant: {
      id: string;
      brandName: string;
      status: string;
      planPeriodicity: string | null;
      currentPeriodEnd: Date | null;
    },
    ctx: { amountUsd: number | null },
    _whiteLabelId: string,
  ) {
    const wasSuspended = tenant.status === 'SUSPENDED';
    const wasActive = tenant.status === 'ACTIVE';
    // Fase 1 (cargo único): próximo cobro = ahora + periodicidad del plan
    // (default mensual). En Fase 2 con suscripciones vendrá del proveedor.
    const nextCharge =
      tenant.currentPeriodEnd ??
      addPlanPeriod(new Date(), tenant.planPeriodicity ?? 'MENSUAL');

    // PDF Soft 10: fecha real de compra — set-once en la 1ª activación (no se
    // pisa en renovaciones). Cross (Fase 1) activa en el webhook, cerca del pago.
    const curPurchase = await this.prisma.tenant.findUnique({
      where: { id: tenant.id },
      select: { purchasedAt: true },
    });
    await this.prisma.tenant.update({
      where: { id: tenant.id },
      data: {
        status: 'ACTIVE',
        ...(ctx.amountUsd != null ? { lastPaymentAmountUsd: ctx.amountUsd } : {}),
        currentPeriodEnd: nextCharge,
        lastChargeAt: new Date(),
        ...(curPurchase?.purchasedAt ? {} : { purchasedAt: new Date() }),
        failedPaymentCount: 0,
        lastPaymentAttemptAt: new Date(),
        suspendedAt: null,
        trialEndsAt: null,
        paymentReminderSentFor: null,
        paymentFailureNoticeSentAt: null,
        pausePendingNoticeSentAt: null,
      },
    });
    await this.billing.clearCreditRelease(tenant.id).catch(() => null);
    await this.billing
      .auditLifecycle(
        wasSuspended ? 'subscription.reactivated' : 'subscription.payment_succeeded',
        tenant.id,
        { gateway: 'CROSS', amountUsd: ctx.amountUsd ?? null },
      )
      .catch(() => null);
    // Primer pago o reactivación (no renovaciones) → business.activated.
    if (!wasActive) {
      void this.onboardingWebhook.emitBusinessActivated(tenant.id);
    }
    // SMS best-effort.
    if (wasSuspended) {
      this.smsTemplates
        .render('account_reactivated', { brandName: tenant.brandName }, tenant.id)
        .then((msg) => this.notifyOwner(tenant.id, tenant.brandName, msg))
        .catch(() => null);
    } else {
      const nextChargeInfo = ` Próximo cobro: ${fmtSmsDate(nextCharge)}.`;
      this.smsTemplates
        .render('payment_confirmed', { brandName: tenant.brandName, nextChargeInfo }, tenant.id)
        .then((msg) => this.notifyOwner(tenant.id, tenant.brandName, msg))
        .catch(() => null);
    }
  }

  /** Activa un tenant conocido por id — lo usa /auth/signup al consumir un
   *  PendingCrossPayment (flujo pago → datos). */
  async activateForTenant(tenantId: string, amountUsd: number | null, whiteLabelId: string) {
    const tenant = await this.getTenant(tenantId);
    if (!tenant) return false;
    await this.activate(tenant, { amountUsd }, whiteLabelId);
    return true;
  }

  /** Consume un PendingCrossPayment por email al crear la cuenta (/auth/signup).
   *  Match por email + whiteLabelId del tenant recién creado. */
  async consumePendingForTenant(tenantId: string, email: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true, whiteLabelId: true },
    });
    if (!tenant?.whiteLabelId) return false;
    const e = (email ?? '').trim().toLowerCase();
    if (!e) return false;
    const pending = await this.prisma.pendingCrossPayment.findFirst({
      where: { email: e, whiteLabelId: tenant.whiteLabelId, consumedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    if (!pending) return false;
    // Solo activamos si el pago ya está aprobado (status del pendiente lo refleja
    // cuando el webhook llegó antes del signup). Si sigue pendiente, el webhook
    // aprobado activará luego por email.
    await this.prisma.pendingCrossPayment.update({
      where: { id: pending.id },
      data: { consumedAt: new Date() },
    });
    if (pending.status && this.mapStatus(pending.status) !== 'APPROVED') {
      // No aprobado aún → dejamos consumido pero sin activar; el webhook lo hará.
      return false;
    }
    const amount = pending.amountUsd != null ? Number(pending.amountUsd) : null;
    try {
      await this.activateForTenant(tenantId, amount, tenant.whiteLabelId);
    } catch (err) {
      await this.prisma.pendingCrossPayment
        .update({ where: { id: pending.id }, data: { consumedAt: null } })
        .catch(() => undefined);
      throw err;
    }
    this.logger.log(`PendingCrossPayment consumido para tenant=${tenantId} (${e})`);
    return true;
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private async getTenant(tenantId: string) {
    return this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true, brandName: true, status: true, planPeriodicity: true, currentPeriodEnd: true },
    });
  }

  private async findTenantByEmail(whiteLabelId: string, email: string) {
    const owner = await this.prisma.user.findFirst({
      where: {
        email: (email ?? '').toLowerCase(),
        role: 'TENANT_OWNER',
        tenantId: { not: null },
        tenant: { whiteLabelId },
      },
      select: { tenantId: true },
    });
    if (!owner?.tenantId) return null;
    return this.getTenant(owner.tenantId);
  }

  private async recordTransaction(
    brand: CrossBrand,
    d: {
      providerRef: string;
      email?: string | null;
      amountUsd?: number | null;
      currency?: string | null;
      status: NormalizedPaymentStatus;
      providerStatus?: string | null;
      event?: string | null;
      tenantId?: string | null;
    },
  ) {
    await this.prisma.crossTransaction
      .upsert({
        where: { providerRef: d.providerRef },
        create: {
          providerRef: d.providerRef,
          whiteLabelId: brand.whiteLabelId,
          tenantId: d.tenantId ?? null,
          email: d.email ? d.email.trim().toLowerCase() : null,
          amountUsd: d.amountUsd ?? null,
          currency: d.currency ?? null,
          status: d.status,
          providerStatus: d.providerStatus ?? null,
          event: d.event ?? null,
          environment: brand.environment,
        },
        update: {
          status: d.status,
          providerStatus: d.providerStatus ?? undefined,
          event: d.event ?? undefined,
        },
      })
      .catch((e) => this.logger.warn(`recordTransaction falló: ${e?.message}`));
  }

  private async updateTransactionStatus(
    brand: CrossBrand,
    evt: NormalizedWebhookEvent,
    processingMs: number,
  ) {
    await this.prisma.crossTransaction
      .upsert({
        where: { providerRef: evt.providerRef },
        create: {
          providerRef: evt.providerRef,
          whiteLabelId: brand.whiteLabelId,
          status: evt.status,
          providerStatus: evt.providerStatus,
          event: evt.event,
          environment: brand.environment,
          processingMs,
        },
        update: {
          status: evt.status,
          providerStatus: evt.providerStatus,
          event: evt.event,
          processingMs,
        },
      })
      .catch((e) => this.logger.warn(`updateTransactionStatus falló: ${e?.message}`));
  }

  private async storePending(
    brand: CrossBrand,
    d: { email: string; providerRef: string; amountUsd: number; currency: string; raw: unknown },
  ) {
    const email = (d.email ?? '').trim().toLowerCase();
    if (!email) return;
    const dup = await this.prisma.pendingCrossPayment.findFirst({
      where: { providerRef: d.providerRef, consumedAt: null },
    });
    if (dup) return;
    await this.prisma.pendingCrossPayment.create({
      data: {
        email,
        whiteLabelId: brand.whiteLabelId,
        providerRef: d.providerRef,
        amountUsd: d.amountUsd,
        currency: d.currency,
        status: 'PENDING',
        rawPayload: d.raw as object,
      },
    });
  }

  /** Marca el PendingCrossPayment como aprobado cuando llega el webhook (para
   *  que un signup posterior active de una). */
  private async markPendingApproved(providerRef: string, status: string) {
    await this.prisma.pendingCrossPayment
      .updateMany({
        where: { providerRef, consumedAt: null },
        data: { status },
      })
      .catch(() => null);
  }

  /** SMS best-effort al dueño (mismo resolver de billing que Hotmart/Stripe). */
  private async notifyOwner(tenantId: string, brandName: string, message: string) {
    if (!message) return;
    const target = await this.billing.resolveBillingTarget(tenantId);
    if (!target) return;
    const r = await this.growBusiness
      .sendSmsWithCreds(target.creds, target.phone, message)
      .catch((e) => ({ ok: false as const, message: e?.message }));
    if (r.ok) this.logger.log(`SMS Cross enviado a ${brandName} (${target.phone})`);
    else this.logger.warn(`SMS Cross falló para ${brandName}: ${r.message ?? 'unknown'}`);
  }

  /** Expone loadBrand para el controller (checkout/webhook por slug). */
  async brandForSlug(slug: string) {
    return this.loadBrand(slug);
  }
}

function safeJson(text: string): any {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function safeEqualHex(a: string, b: string): boolean {
  try {
    const ba = Buffer.from(a.trim().toLowerCase(), 'hex');
    const bb = Buffer.from(b.trim().toLowerCase(), 'hex');
    if (ba.length === 0 || ba.length !== bb.length) return false;
    return timingSafeEqual(ba, bb);
  } catch {
    return false;
  }
}
