import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { GrowBusinessService } from '../integrations/grow-business.service';
import { EmailService } from '../email/email.service';
import { BillingService } from './billing.service';
import { ReferralsService } from '../referrals/referrals.service';
import { PreregAlertsService } from '../auth/prereg-alerts.service';
import { CommissionExceptionsService } from '../admin/commission-exceptions.service';
import {
  smsPaymentConfirmed,
  smsPaymentFailed,
} from './billing-sms-templates';

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Tipos de evento que Hotmart envía vía webhook.
 * Solo procesamos los críticos para el ciclo de vida de la suscripción.
 */
export type HotmartEventType =
  | 'PURCHASE_APPROVED'
  | 'PURCHASE_COMPLETE'
  | 'SUBSCRIPTION_CANCELLATION'
  | 'PURCHASE_REFUNDED'
  | 'PURCHASE_CHARGEBACK'
  | 'PURCHASE_DELAYED'
  | 'PURCHASE_BILLET_PRINTED'
  | 'PURCHASE_PROTEST'
  | 'SWITCH_PLAN'
  | 'UPDATE_SUBSCRIPTION_CHARGE_DATE';

export type HotmartWebhookPayload = {
  id?: string;
  event?: HotmartEventType;
  hottok?: string;
  data?: {
    buyer?: { email?: string; name?: string };
    subscription?: {
      subscriber?: { code?: string };
      plan?: { name?: string };
      date_next_charge?: number;
      status?: string;
    };
    purchase?: {
      transaction?: string;
      status?: string;
      approved_date?: number;
      // Hotmart manda el monto pagado en USD aquí. Lo usamos para calcular
      // la comisión del referido. Si no viene, caemos a plan.priceMonthly.
      price?: { value?: number; currency_code?: string };
    };
    product?: { id?: number; name?: string };
  };
};

@Injectable()
export class HotmartService {
  private logger = new Logger(HotmartService.name);

  constructor(
    private prisma: PrismaService,
    private growBusiness: GrowBusinessService,
    private email: EmailService,
    private billing: BillingService,
    private referralsService: ReferralsService,
    private alerts: PreregAlertsService,
    private commissionExceptions: CommissionExceptionsService,
  ) {}

  /** Best-effort: manda SMS al dueño, no falla el webhook si no se puede.
   *  Usa el mismo resolver de billing (subcuenta global > creds tenant +
   *  override de teléfono + toggle billingAlertsEnabled). Si el owner
   *  apagó alertas o no hay creds/teléfono → silent skip. */
  private async notifyOwner(tenantId: string, brandName: string, message: string) {
    const target = await this.billing.resolveBillingTarget(tenantId);
    if (!target) return;
    const r = await this.growBusiness
      .sendSmsWithCreds(target.creds, target.phone, message)
      .catch((e) => ({ ok: false as const, message: e?.message }));
    if (r.ok) {
      this.logger.log(`SMS Hotmart enviado a ${brandName} (${target.phone})`);
    } else {
      this.logger.warn(
        `SMS Hotmart falló para ${brandName}: ${r.message ?? 'unknown'}`,
      );
    }
  }

  /** Verifica el HOTTOK contra el env, requerido en cada webhook real. */
  verifyHottok(hottok?: string): boolean {
    const expected = process.env.HOTMART_HOTTOK;
    if (!expected) {
      // En dev sin HOTTOK configurado, dejamos pasar para poder probar.
      return process.env.NODE_ENV !== 'production';
    }
    return hottok === expected;
  }

  /**
   * Procesa el payload del webhook. Devuelve `{ ok, action }` describiendo
   * qué se hizo. NO lanza errores al caller; loggea y persiste para debugging
   * porque Hotmart reintenta agresivamente y queremos 200 idempotente.
   */
  async handleEvent(payload: HotmartWebhookPayload) {
    const event = payload.event;
    const buyerEmail = payload.data?.buyer?.email?.toLowerCase();
    const subscriberCode = payload.data?.subscription?.subscriber?.code;
    const transactionId = payload.data?.purchase?.transaction;

    this.logger.log(
      `Hotmart event=${event} buyer=${buyerEmail} subscriber=${subscriberCode} tx=${transactionId}`,
    );

    if (!event) return { ok: true, action: 'no_event' };

    // Localizar tenant por email del buyer (caso primer pago) o por subscriberCode (renovaciones).
    const tenant = await this.findTenant({ buyerEmail, subscriberCode });
    if (!tenant) {
      // Flujo "pago → datos" (referido): el cliente puede pagar ANTES de
      // crear la cuenta. Si es un pago aprobado y todavía no hay tenant,
      // NO perdemos el pago: lo guardamos como PendingHotmartPayment para
      // que /auth/signup lo consuma al crear la cuenta (match por email) y
      // active el tenant al instante. Para el resto de eventos sin tenant
      // (cancelación/refund/etc.) seguimos ignorando.
      if (
        (event === 'PURCHASE_APPROVED' || event === 'PURCHASE_COMPLETE') &&
        buyerEmail
      ) {
        await this.storePendingPayment({
          event,
          buyerEmail,
          subscriberCode,
          transactionId,
          payload,
        }).catch((e) =>
          this.logger.warn(
            `storePendingPayment falló para ${buyerEmail}: ${(e as Error).message}`,
          ),
        );
        return { ok: true, action: 'pending_stored' };
      }
      this.logger.warn(
        `Hotmart event ${event}: no tenant matched (email=${buyerEmail} subscriber=${subscriberCode})`,
      );
      return { ok: true, action: 'tenant_not_found' };
    }

    switch (event) {
      case 'PURCHASE_APPROVED':
      case 'PURCHASE_COMPLETE':
        return this.activatePurchase(tenant, payload);

      case 'PURCHASE_BILLET_PRINTED': {
        // HOTFIX 2026-06-05 (bug Q): imprimir un boleto bancario (BR) NO
        // es un fallo de pago — es modo de pago pendiente. Antes caía
        // junto con DELAYED/PROTEST y disparaba failedPaymentCount + SMS
        // "tu pago falló" al cliente que en realidad sí va a pagar.
        // Ahora solo registra el intento sin marcar PAST_DUE.
        await this.prisma.tenant.update({
          where: { id: tenant.id },
          data: { lastPaymentAttemptAt: new Date() },
        });
        return { ok: true, action: 'billet_printed' };
      }

      case 'PURCHASE_DELAYED':
      case 'PURCHASE_PROTEST': {
        // No tocamos `status` (el enum solo tiene ACTIVE/TRIAL/SUSPENDED).
        // El derivado PAST_DUE lo calcula billing.service.getStatus()
        // basándose en failedPaymentCount > 0.
        const now = new Date();
        await this.prisma.tenant.update({
          where: { id: tenant.id },
          data: {
            failedPaymentCount: { increment: 1 },
            lastPaymentAttemptAt: now,
            paymentFailureNoticeSentAt: now,
          },
        });
        // SMS aviso de falla (best-effort)
        this.notifyOwner(
          tenant.id,
          tenant.brandName,
          smsPaymentFailed({ brandName: tenant.brandName }),
        ).catch(() => null);
        // Aviso a la cadena de atribución (embajador → influencer → admin)
        // si el dueño activó las notificaciones de pago fallido.
        this.notifyReferralChain(tenant.id, tenant.brandName, 'PAYMENT_FAILED').catch(
          () => null,
        );
        return { ok: true, action: 'past_due' };
      }

      case 'PURCHASE_REFUNDED':
      case 'PURCHASE_CHARGEBACK':
      case 'SUBSCRIPTION_CANCELLATION': {
        await this.prisma.tenant.update({
          where: { id: tenant.id },
          data: {
            status: 'SUSPENDED',
            suspendedAt: new Date(),
          },
        });
        // Reflejar el cambio en el referido. CHURNED frena nuevas comisiones
        // recurrentes. Si fue refund/chargeback, además rechazamos la última
        // comisión PENDING/APPROVED para no pagar algo que el cliente revirtió.
        const isRefundOrChargeback =
          event === 'PURCHASE_REFUNDED' || event === 'PURCHASE_CHARGEBACK';
        await this.churnReferral({
          tenantId: tenant.id,
          rejectLastCommission: isRefundOrChargeback,
        }).catch((e) =>
          this.logger.warn(`churnReferral falló: ${(e as Error).message}`),
        );
        // Aviso a la cadena de atribución
        this.notifyReferralChain(tenant.id, tenant.brandName, 'CHURNED').catch(
          () => null,
        );
        return { ok: true, action: 'suspended' };
      }

      case 'UPDATE_SUBSCRIPTION_CHARGE_DATE': {
        const next = payload.data?.subscription?.date_next_charge;
        if (next) {
          await this.prisma.tenant.update({
            where: { id: tenant.id },
            data: { currentPeriodEnd: new Date(next) },
          });
        }
        return { ok: true, action: 'updated_next_charge' };
      }

      case 'SWITCH_PLAN': {
        const planName = payload.data?.subscription?.plan?.name;
        if (planName) {
          const plan = await this.prisma.plan.findFirst({
            where: { name: { equals: planName, mode: 'insensitive' } },
          });
          if (plan) {
            await this.prisma.tenant.update({
              where: { id: tenant.id },
              data: { planId: plan.id },
            });
          }
        }
        return { ok: true, action: 'plan_switched' };
      }

      default:
        return { ok: true, action: 'unhandled' };
    }
  }

  /**
   * Activa un tenant tras un pago aprobado (PURCHASE_APPROVED/COMPLETE):
   * pone status=ACTIVE, fija el próximo cobro, genera la comisión del
   * referido y dispara el fan-out comercial. Es el corazón del webhook
   * extraído a método propio para poder re-usarlo desde /auth/signup
   * cuando el cliente pagó ANTES de crear la cuenta (PendingHotmartPayment).
   */
  private async activatePurchase(
    tenant: {
      id: string;
      brandName: string;
      hotmartSubscriberCode: string | null;
      hotmartTransactionId: string | null;
    },
    payload: HotmartWebhookPayload,
  ) {
    const subscriberCode = payload.data?.subscription?.subscriber?.code;
    const transactionId = payload.data?.purchase?.transaction;
    const nextCharge = payload.data?.subscription?.date_next_charge
      ? new Date(payload.data.subscription.date_next_charge)
      : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    await this.prisma.tenant.update({
      where: { id: tenant.id },
      data: {
        status: 'ACTIVE',
        currentPeriodEnd: nextCharge,
        hotmartSubscriberCode: subscriberCode ?? tenant.hotmartSubscriberCode,
        hotmartTransactionId: transactionId ?? tenant.hotmartTransactionId,
        failedPaymentCount: 0,
        lastPaymentAttemptAt: new Date(),
        suspendedAt: null,
        // 2026-06-06: el trial termina cuando hay pago confirmado. Limpiamos
        // trialEndsAt para que el dashboard no muestre "Trial: X días
        // restantes" junto con el plan pagado. trialStartedAt y trialSource
        // se preservan para analytics de conversión.
        trialEndsAt: null,
        // Reset de tracking de notificaciones para el nuevo ciclo
        paymentReminderSentFor: null,
        paymentFailureNoticeSentAt: null,
        pausePendingNoticeSentAt: null,
      },
    });
    // Generar la comisión recurrente del referido. Idempotente por
    // tx/período: si ya creamos una comisión para esta misma transacción
    // o en los últimos 25 días, skipea.
    //
    // FASE FOUNDATION 2026-06-05: si el tenant fue traído por un
    // ReferralCode con role=VENDOR, usamos el nuevo 3-way generator
    // que crea hasta 3 commission rows (influencer + embajador +
    // vendor) con dedup por hotmartTransactionId + recipientCodeId.
    // Para sales sin vendor en la chain (legacy INFLUENCER/AMBASSADOR
    // directos), seguimos con el flujo histórico de generateReferralCommission.
    try {
      // HOTFIX 2026-06-05 (bug #6 CRÍTICO): si un tenant fue
      // reasignado a otro afiliado, el findFirst sin orderBy podía
      // devolver el VENDOR viejo (no convertido) y generar 3-way
      // commissions a alguien que ya no atrae al cliente. Ahora:
      //  1) Filtramos por status PAYING/ACTIVE (atribución viva).
      //  2) Ordenamos por createdAt desc para tomar la atribución
      //     más reciente.
      const vendorUse = await this.prisma.referralUse.findFirst({
        where: {
          tenantId: tenant.id,
          referralCode: { role: 'VENDOR' },
          status: { in: ['PAYING', 'ACTIVE'] },
        },
        orderBy: { createdAt: 'desc' },
        select: { id: true },
      });
      if (vendorUse) {
        // Precio: usamos el monto Hotmart real si vino, sino plan.
        const planForRate = await this.prisma.tenant.findUnique({
          where: { id: tenant.id },
          select: { plan: { select: { priceMonthly: true } } },
        });
        const basePrice =
          payload.data?.purchase?.price?.value &&
          payload.data.purchase.price.value > 0
            ? payload.data.purchase.price.value
            : Number(planForRate?.plan?.priceMonthly ?? 0);
        await this.referralsService.generateCommissionsForPayment({
          tenantId: tenant.id,
          paymentAmountUsd: basePrice,
          hotmartTransactionId: transactionId ?? null,
        });
      } else {
        await this.generateReferralCommission({
          tenantId: tenant.id,
          paidAmount: payload.data?.purchase?.price?.value ?? null,
          transactionId,
        });
      }
    } catch (e) {
      this.logger.warn(
        `generación de comisión falló: ${(e as Error).message}`,
      );
    }
    // SMS de confirmación al dueño (best-effort)
    this.notifyOwner(
      tenant.id,
      tenant.brandName,
      smsPaymentConfirmed({
        brandName: tenant.brandName,
        nextChargeDate: nextCharge,
      }),
    ).catch(() => null);

    // Fan-out post-activación (C2 sprint): alerta al equipo comercial,
    // creación de CrmContact en el pipeline del afiliado atribuido y
    // event audit row. Todos fire-and-forget — si fallan no rompen el
    // webhook (Hotmart reintenta agresivamente y queremos 200 idempotente).
    await this.postPurchaseFanOut({
      tenantId: tenant.id,
      brandName: tenant.brandName,
      nextCharge,
      transactionId,
    }).catch((e) =>
      this.logger.warn(`postPurchaseFanOut falló: ${(e as Error).message}`),
    );

    return { ok: true, action: 'activated' };
  }

  /**
   * Activa un tenant ya conocido por id (flujo "pago → datos"): lo usa
   * /auth/signup al consumir un PendingHotmartPayment. NO pasa por
   * findTenant (no re-guarda pending) — la cuenta acaba de crearse.
   */
  async activatePurchaseForTenant(
    tenantId: string,
    payload: HotmartWebhookPayload,
  ) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: {
        id: true,
        brandName: true,
        hotmartSubscriberCode: true,
        hotmartTransactionId: true,
      },
    });
    if (!tenant) return { ok: true, action: 'tenant_not_found' };
    return this.activatePurchase(tenant, payload);
  }

  /**
   * Guarda un pago de Hotmart que llegó SIN cuenta (flujo "pago → datos").
   * Dedup por email + transacción para tolerar los reintentos de Hotmart.
   * Dispara recuperación (email al comprador + SMS al equipo) la primera vez.
   */
  private async storePendingPayment(args: {
    event: HotmartEventType;
    buyerEmail: string;
    subscriberCode?: string;
    transactionId?: string;
    payload: HotmartWebhookPayload;
  }) {
    const email = args.buyerEmail.toLowerCase();
    const existing = await this.prisma.pendingHotmartPayment.findFirst({
      where: {
        email,
        consumedAt: null,
        ...(args.transactionId ? { transactionId: args.transactionId } : {}),
      },
    });
    if (existing) {
      this.logger.log(
        `PendingHotmartPayment ya existe para ${email} (tx=${args.transactionId ?? '—'}) — skip`,
      );
      return;
    }
    await this.prisma.pendingHotmartPayment.create({
      data: {
        email,
        subscriberCode: args.subscriberCode ?? null,
        transactionId: args.transactionId ?? null,
        event: args.event,
        rawPayload: args.payload as any,
      },
    });
    this.logger.log(
      `Pago Hotmart sin cuenta — guardado PendingHotmartPayment para ${email} (tx=${args.transactionId ?? '—'})`,
    );
    await this.notifyPendingRecovery({
      email,
      name: args.payload.data?.buyer?.name ?? null,
    }).catch(() => null);
  }

  /**
   * Recuperación de pago "huérfano": email al comprador con el link a
   * /activar para completar su cuenta + SMS al equipo comercial. Marca
   * recoveryNotifiedAt para no re-enviar en reintentos del webhook.
   */
  private async notifyPendingRecovery(opts: {
    email: string;
    name: string | null;
  }) {
    const appUrl = process.env.APP_URL ?? 'https://soyclubify.com';
    const activateUrl = `${appUrl}/activar`;
    const greeting = opts.name ? ` ${opts.name}` : '';
    await this.email.send({
      to: opts.email,
      subject: 'Completa tu cuenta de Clubify',
      html: `<p>Hola${greeting},</p>
<p>Recibimos tu pago 🎉. Solo falta crear tu cuenta para empezar a usar Clubify.</p>
<p><a href="${activateUrl}" style="display:inline-block;background:#22C55E;color:#fff;padding:12px 20px;border-radius:999px;text-decoration:none;font-weight:600">Completar mi cuenta →</a></p>
<p>Importante: usa el mismo correo con el que pagaste (<strong>${opts.email}</strong>) para que activemos tu cuenta al instante.</p>`,
      text: `Recibimos tu pago. Completa tu cuenta en ${activateUrl} usando el correo ${opts.email}.`,
    });
    this.alerts
      .sendTeamAlert(
        `💳 Pago Hotmart recibido SIN cuenta aún.\nEmail: ${opts.email}\nSe le envió link a /activar para completar. Si no aparece la cuenta pronto, contactar.`,
      )
      .catch(() => null);
    await this.prisma.pendingHotmartPayment
      .updateMany({
        where: { email: opts.email, consumedAt: null, recoveryNotifiedAt: null },
        data: { recoveryNotifiedAt: new Date() },
      })
      .catch(() => null);
  }

  /**
   * Consume un PendingHotmartPayment para un email recién registrado.
   * Lo invoca /auth/signup (vía AuthService) tras crear la cuenta. Match
   * tolerante al `+alias` que Hotmart strippea. Devuelve true si activó.
   */
  async consumePendingForTenant(
    tenantId: string,
    signupEmail: string,
  ): Promise<boolean> {
    const email = signupEmail.toLowerCase();
    const stripPlus = (e: string) => e.replace(/\+[^@]*@/, '@').toLowerCase();
    let pending = await this.prisma.pendingHotmartPayment.findFirst({
      where: { email, consumedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    if (!pending) {
      // Fallback tolerante al +alias: escaneo acotado de pendientes.
      const candidates = await this.prisma.pendingHotmartPayment.findMany({
        where: { consumedAt: null },
        orderBy: { createdAt: 'desc' },
        take: 100,
      });
      pending =
        candidates.find((p) => {
          const pe = p.email.toLowerCase();
          return (
            pe === email ||
            stripPlus(pe) === email ||
            pe === stripPlus(email) ||
            stripPlus(pe) === stripPlus(email)
          );
        }) ?? null;
    }
    if (!pending) return false;
    // Marcar consumido ANTES de activar (idempotencia ante reintentos del
    // signup) y activar el tenant recién creado. Si activate falla,
    // revertimos consumedAt para que un retry posterior pueda recuperarlo
    // (sino el cliente queda PAGÓ-pero-NO-ACTIVO sin forma de recovery).
    await this.prisma.pendingHotmartPayment.update({
      where: { id: pending.id },
      data: { consumedAt: new Date() },
    });
    try {
      await this.activatePurchaseForTenant(
        tenantId,
        pending.rawPayload as unknown as HotmartWebhookPayload,
      );
    } catch (err) {
      await this.prisma.pendingHotmartPayment
        .update({ where: { id: pending.id }, data: { consumedAt: null } })
        .catch(() => undefined);
      throw err;
    }
    this.logger.log(
      `PendingHotmartPayment consumido para tenant=${tenantId} (email=${email})`,
    );
    return true;
  }

  private async findTenant({
    buyerEmail,
    subscriberCode,
  }: {
    buyerEmail?: string;
    subscriberCode?: string;
  }) {
    if (subscriberCode) {
      const t = await this.prisma.tenant.findFirst({
        where: { hotmartSubscriberCode: subscriberCode },
        select: {
          id: true,
          brandName: true,
          hotmartSubscriberCode: true,
          hotmartTransactionId: true,
        },
      });
      if (t) return t;
    }
    if (buyerEmail) {
      let user = await this.prisma.user.findFirst({
        where: { email: buyerEmail, role: 'TENANT_OWNER', tenantId: { not: null } },
        select: { tenantId: true },
      });
      // Fallback: Hotmart a veces strippea el sufijo `+alias` del email del
      // comprador (ej. signup con `juan+test1@gmail.com` → buyer queda como
      // `juantest1@gmail.com`). Si no hubo match exacto y el buyer no tiene
      // `+`, buscamos un owner cuya parte local sin `+...` coincida.
      if (!user && !buyerEmail.includes('+')) {
        const at = buyerEmail.indexOf('@');
        if (at > 0) {
          const local = buyerEmail.slice(0, at);
          const domain = buyerEmail.slice(at);
          // Match `<algo>+<algo>@dominio` donde <algo>+<algo> sin `+` sea local
          const candidates = await this.prisma.user.findMany({
            where: {
              role: 'TENANT_OWNER',
              tenantId: { not: null },
              email: { endsWith: domain, contains: '+', mode: 'insensitive' },
            },
            select: { email: true, tenantId: true },
            take: 50,
          });
          const stripPlus = (e: string) =>
            e.replace(/\+[^@]*@/, '@').toLowerCase();
          const match = candidates.find((c) => stripPlus(c.email) === buyerEmail);
          if (match) {
            this.logger.log(
              `Hotmart email match via +alias strip: buyer=${buyerEmail} matched user=${match.email}`,
            );
            user = { tenantId: match.tenantId };
          }
        }
      }
      if (user?.tenantId) {
        return this.prisma.tenant.findUnique({
          where: { id: user.tenantId },
          select: {
            id: true,
            brandName: true,
            hotmartSubscriberCode: true,
            hotmartTransactionId: true,
          },
        });
      }
    }
    return null;
  }

  /**
   * Construye la URL de checkout. Las env vars son:
   *   HOTMART_PRODUCT_ID_ELITE  → producto del plan Elite ($50)
   *   HOTMART_PRODUCT_ID        → fallback genérico
   *   HOTMART_OFFER_CODE_ELITE  → opcional, `off=` para offer específica
   *   HOTMART_BID_ELITE         → opcional, `bid=` para tracking de oferta
   */
  /**
   * Construye la URL de checkout. Soporta 2 modos de descuento:
   *
   *   A) Offer pre-configurada — env var HOTMART_OFFER_CODE_<PLAN> +
   *      HOTMART_BID_<PLAN>. La offer ya tiene el descuento aplicado en
   *      Hotmart; el cliente paga el precio reducido sin tipear nada.
   *
   *   B) Coupon manual — Setting key `billing.hotmartCouponCode` (o el
   *      override `couponCode` del caller). Se agrega `?couponCode=X` al
   *      query y Hotmart aplica el descuento al cargar el checkout.
   *      Setting global por ahora (todos los tenants reciben el mismo
   *      coupon); si en el futuro queremos cupones por campaña se mueve
   *      a Tenant.
   *
   * Ambos modos son compatibles entre sí — pueden coexistir si la offer
   * ya tiene precio rebajado Y el coupon agrega más descuento.
   */
  async buildCheckoutUrl(opts: {
    email?: string;
    planName?: string;
    couponCode?: string;
  }) {
    const productId = this.resolveProductId(opts.planName);
    if (!productId) return null;
    const offerCode = this.resolveOfferCode(opts.planName);
    const bid = this.resolveBid(opts.planName);
    const coupon = opts.couponCode ?? (await this.resolveGlobalCoupon());
    const base = `https://pay.hotmart.com/${productId}`;
    const params = new URLSearchParams();
    if (offerCode) params.set('off', offerCode);
    if (bid) params.set('bid', bid);
    if (opts.email) params.set('email', opts.email);
    if (coupon) params.set('couponCode', coupon);
    const qs = params.toString();
    return qs ? `${base}?${qs}` : base;
  }

  /** Busca un coupon global configurado en Settings. Cualquier admin
   *  puede setearlo desde /admin/billing — se aplica a TODOS los
   *  checkouts. Usar string vacío para limpiar (= sin coupon). */
  private async resolveGlobalCoupon(): Promise<string | undefined> {
    const s = await this.prisma.setting.findUnique({
      where: { key: 'billing.hotmartCouponCode' },
    });
    const v = s?.value?.trim();
    return v ? v : undefined;
  }

  private resolveProductId(planName?: string): string | undefined {
    const key = this.planKey(planName);
    if (key) {
      const specific = process.env[`HOTMART_PRODUCT_ID_${key}`];
      if (specific) return specific;
    }
    return process.env.HOTMART_PRODUCT_ID;
  }

  private resolveOfferCode(planName?: string): string | undefined {
    const key = this.planKey(planName);
    if (key) {
      const specific = process.env[`HOTMART_OFFER_CODE_${key}`];
      if (specific) return specific;
    }
    return process.env.HOTMART_OFFER_CODE;
  }

  private resolveBid(planName?: string): string | undefined {
    const key = this.planKey(planName);
    if (key) {
      const specific = process.env[`HOTMART_BID_${key}`];
      if (specific) return specific;
    }
    return process.env.HOTMART_BID;
  }

  /** Único plan vivo es Elite. Cualquier otro nombre cae al fallback. */
  private planKey(planName?: string): string | undefined {
    if (!planName) return undefined;
    const n = planName.toLowerCase().trim();
    if (n === 'elite') return 'ELITE';
    return undefined;
  }

  isConfigured(): boolean {
    const hasAnyProduct =
      !!process.env.HOTMART_PRODUCT_ID ||
      !!process.env.HOTMART_PRODUCT_ID_ELITE;
    return hasAnyProduct && !!process.env.HOTMART_HOTTOK;
  }

  // ============================================================
  //   Comisiones de referidos — automatización (Fase 1)
  // ============================================================

  /**
   * Genera la(s) Commission asociadas a un pago confirmado de Hotmart,
   * con conciencia de roles (Fase 2):
   *
   * - DIRECTA: el código usado (influencer 30% por default, embajador 25%).
   * - INDIRECTA: si el código es de un EMBAJADOR, su `parentCode`
   *   (el INFLUENCER dueño de la campaña) recibe 5%.
   * - SOCIO: 10% global de TODA venta. Tenant sin referido también
   *   genera esta. El socio se identifica por Setting key
   *   `referrals.socioCodeId`.
   *
   * Idempotente por ReferralUse: si la última comisión del use es
   * < 25 días, skipea (mismo ciclo).
   *
   * Si tenant no tiene ReferralUse, igual generamos la del SOCIO sobre un
   * "use sintético" — para no perder la atribución global. Lo modelamos
   * creando un ReferralUse para el código del socio con tenantId del cliente.
   */
  private async generateReferralCommission(opts: {
    tenantId: string;
    paidAmount: number | null;
    transactionId?: string;
  }) {
    // Resolver precio original del plan + monto efectivamente pagado.
    // Hotmart envía el monto cobrado en `purchase.price.value` (ya con
    // descuento si aplicó cupón). El precio original lo sacamos del plan.
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: opts.tenantId },
      select: { plan: { select: { priceMonthly: true } } },
    });
    const originalPrice = Number(tenant?.plan?.priceMonthly ?? 0);
    const amountPaid = opts.paidAmount && opts.paidAmount > 0 ? opts.paidAmount : originalPrice;
    if (!originalPrice || originalPrice <= 0) {
      this.logger.warn(`Skip comisión: sin precio para tenant=${opts.tenantId}`);
      return;
    }

    // 1) Comisión DIRECTA (+ posible INDIRECTA al influencer parent).
    const use = await this.prisma.referralUse.findFirst({
      where: {
        tenantId: opts.tenantId,
        // El use del socio (creado abajo) tiene role=SOCIO; lo excluimos para
        // que no se mezcle con la atribución directa del cliente.
        referralCode: { role: { in: ['INFLUENCER', 'AMBASSADOR'] } },
      },
      include: {
        referralCode: { include: { parentCode: true } },
        commissions: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
      orderBy: { createdAt: 'desc' },
    });

    // 2026-06-06 (bug item 7): la comisión se calcula sobre el MONTO
    // EFECTIVAMENTE PAGADO por Hotmart, no sobre `priceMonthly`. Con los 4
    // planes (Mensual 68 / Trimestral 150 / Semestral 278 / Anual 500), el
    // priceMonthly fijo del plan no refleja el cobro real del ciclo. Si
    // Hotmart manda el monto en el payload (purchase.price.value), ese es
    // la base canónica. Solo caemos a originalPrice si el payload viene
    // vacío (Hotmart raro o reconcile manual).
    const referralBase = amountPaid;
    const socioBase = amountPaid;

    if (use) {
      const last = use.commissions[0];
      const recent = last && (Date.now() - new Date(last.createdAt).getTime()) / 86400_000 < 25;

      // Dedup por transactionId: si ya hay una Commission con el mismo
      // externalTxId (mismo evento Hotmart procesado dos veces, o el
      // backfill manual de convertToPaying generó esta misma comisión),
      // skip silencioso. Si no hay transactionId, el guard "<25 días"
      // sigue cubriendo el caso normal.
      let duplicateByTx = false;
      if (opts.transactionId) {
        const existingTx = await this.prisma.commission.findFirst({
          where: {
            externalTxId: opts.transactionId,
            referralUseId: use.id,
          },
          select: { id: true },
        });
        if (existingTx) duplicateByTx = true;
      }

      if (!recent && !duplicateByTx) {
        // Item 6 sprint: si el SUPER_ADMIN configuró una excepción para
        // este (tenant, recipientCode), el % de la excepción gana.
        const pct = await this.resolvePercent(
          opts.tenantId,
          use.referralCode.id,
          Number(use.referralCode.commissionPercent ?? 25),
        );
        const direct = round2((referralBase * pct) / 100);

        if (use.status === 'SIGNED_UP') {
          await this.prisma.referralUse.update({
            where: { id: use.id },
            data: { status: 'PAYING', convertedAt: new Date() },
          });
        }
        await this.prisma.commission.create({
          data: {
            referralUseId: use.id,
            amount: direct,
            status: 'PENDING',
            externalTxId: opts.transactionId ?? null,
          },
        });
        this.logger.log(
          `Comisión directa: ${use.referralCode.role} ${use.referralCode.code} $${direct} (${pct}% sobre $${referralBase})`,
        );

        // Indirecta: si es embajador, su influencer parent gana 5% por default.
        // Configurable más adelante via Setting key `referrals.indirectPercent`.
        if (use.referralCode.role === 'AMBASSADOR' && use.referralCode.parentCode) {
          const parent = use.referralCode.parentCode;
          const fallbackIndirect = await this.getNumberSetting(
            'referrals.indirectPercent',
            5,
          );
          // Item 6 sprint: el influencer parent también puede tener su
          // propia excepción configurada para este tenant.
          const indirectPct = await this.resolvePercent(
            opts.tenantId,
            parent.id,
            fallbackIndirect,
          );
          const indirect = round2((referralBase * indirectPct) / 100);
          // Necesitamos un ReferralUse del parent para colgar la comisión.
          // Match-or-create: uno por tenantId+codeId.
          const parentUse = await this.prisma.referralUse.upsert({
            where: {
              // Sin unique compuesto en schema → fallback al patrón findFirst+create.
              // Usamos un id sintético via findFirst.
              id: 'sentinel-not-used',
            },
            create: {
              referralCodeId: parent.id,
              tenantId: opts.tenantId,
              status: 'PAYING',
              convertedAt: new Date(),
            },
            update: {},
          }).catch(async () => {
            const existing = await this.prisma.referralUse.findFirst({
              where: { referralCodeId: parent.id, tenantId: opts.tenantId },
            });
            if (existing) return existing;
            return this.prisma.referralUse.create({
              data: {
                referralCodeId: parent.id,
                tenantId: opts.tenantId,
                status: 'PAYING',
                convertedAt: new Date(),
              },
            });
          });
          await this.prisma.commission.create({
            data: {
              referralUseId: parentUse.id,
              amount: indirect,
              status: 'PENDING',
              externalTxId: opts.transactionId ?? null,
            },
          });
          this.logger.log(
            `Comisión indirecta INFLUENCER ${parent.code}: $${indirect} (${indirectPct}%)`,
          );
        }
      } else {
        this.logger.log(`Skip directa duplicada (last < 25d) tenant=${opts.tenantId}`);
      }
    }

    // 2) Comisión SOCIO (10% global). Aplica SIEMPRE, exista o no
    // un código de referido. Solo si el super admin configuró el socio.
    await this.generateSocioCommission(opts.tenantId, socioBase).catch((e) =>
      this.logger.warn(`Comisión socio falló: ${(e as Error).message}`),
    );
  }

  private async generateSocioCommission(tenantId: string, amountPaid: number) {
    const socioRow = await this.prisma.setting.findUnique({
      where: { key: 'referrals.socioCodeId' },
    });
    if (!socioRow?.value) return; // socio no configurado
    const socio = await this.prisma.referralCode.findUnique({
      where: { id: socioRow.value },
    });
    if (!socio || socio.role !== 'SOCIO' || !socio.isActive) return;

    const pct = Number(socio.commissionPercent ?? 10);
    const amount = round2((amountPaid * pct) / 100);

    let use = await this.prisma.referralUse.findFirst({
      where: { referralCodeId: socio.id, tenantId },
      include: { commissions: { orderBy: { createdAt: 'desc' }, take: 1 } },
    });
    if (!use) {
      use = await this.prisma.referralUse
        .create({
          data: {
            referralCodeId: socio.id,
            tenantId,
            status: 'PAYING',
            convertedAt: new Date(),
          },
          include: { commissions: { orderBy: { createdAt: 'desc' }, take: 1 } },
        });
    }
    const last = use.commissions[0];
    if (last && (Date.now() - new Date(last.createdAt).getTime()) / 86400_000 < 25) {
      return; // mismo ciclo
    }
    await this.prisma.commission.create({
      data: { referralUseId: use.id, amount, status: 'PENDING' },
    });
    this.logger.log(`Comisión SOCIO ${socio.code}: $${amount} (${pct}%)`);
  }

  private async getNumberSetting(key: string, defaultValue: number): Promise<number> {
    const row = await this.prisma.setting.findUnique({ where: { key } });
    if (!row?.value) return defaultValue;
    const n = Number(row.value);
    return Number.isFinite(n) ? n : defaultValue;
  }

  /**
   * Resuelve el % de comisión efectivo para un (tenant, recipientCode).
   * Delegado al helper compartido en CommissionExceptionsService para
   * evitar drift con la lógica equivalente del cron en ReferralsService.
   */
  private resolvePercent(
    tenantId: string,
    recipientCodeId: string,
    fallbackPercent: number,
  ): Promise<number> {
    return this.commissionExceptions.resolvePercent(
      tenantId,
      recipientCodeId,
      fallbackPercent,
    );
  }

  /**
   * Marca el ReferralUse como CHURNED (frena recurrencia futura). Si el
   * caller indica `rejectLastCommission`, además rechaza la última
   * comisión PENDING/APPROVED para no pagar lo que el cliente revirtió.
   */
  private async churnReferral(opts: {
    tenantId: string;
    rejectLastCommission: boolean;
  }) {
    const use = await this.prisma.referralUse.findFirst({
      where: { tenantId: opts.tenantId },
      include: {
        commissions: {
          where: { status: { in: ['PENDING', 'APPROVED'] } },
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (!use) return;

    await this.prisma.referralUse.update({
      where: { id: use.id },
      data: { status: 'CHURNED' },
    });

    if (opts.rejectLastCommission && use.commissions[0]) {
      await this.prisma.commission.update({
        where: { id: use.commissions[0].id },
        data: { status: 'REJECTED' },
      });
    }
  }

  /**
   * Notifica a la cadena de atribución (embajador → influencer → admin)
   * cuando un cliente referido entra en estado de pago fallido o se da
   * de baja. Best-effort vía SMS; no falla el webhook si no llega.
   *
   * Toggleable por Setting key:
   *   - referrals.notifyPaymentFailed (default true; 'false' para apagar)
   *   - referrals.notifyChurn (default true)
   *
   * El admin se notifica al WhatsApp de Setting `salesWhatsapp` si existe.
   */
  private async notifyReferralChain(
    tenantId: string,
    brandName: string,
    event: 'PAYMENT_FAILED' | 'CHURNED',
  ) {
    const enabledKey =
      event === 'PAYMENT_FAILED'
        ? 'referrals.notifyPaymentFailed'
        : 'referrals.notifyChurn';
    const enabled = await this.prisma.setting.findUnique({ where: { key: enabledKey } });
    if (enabled?.value === 'false') return;

    const use = await this.prisma.referralUse.findFirst({
      where: {
        tenantId,
        referralCode: { role: { in: ['INFLUENCER', 'AMBASSADOR'] } },
      },
      include: {
        referralCode: { include: { parentCode: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (!use) return;

    const direct = use.referralCode;
    const parent = direct.parentCode;
    const eventLabel =
      event === 'PAYMENT_FAILED' ? '⚠️ Pago fallido' : '⛔ Cliente cancelado';
    const codeLine =
      direct.role === 'AMBASSADOR' && parent
        ? `Embajador: ${direct.ownerName} (${direct.code})\nInfluencer: ${parent.ownerName} (${parent.code})`
        : `Atribución: ${direct.ownerName} (${direct.code})`;
    const message = `${eventLabel}\nCliente: ${brandName}\n${codeLine}`;

    // Canal: SMS (default), EMAIL, o BOTH. Configurable via Setting.
    const channelRow = await this.prisma.setting.findUnique({
      where: { key: 'referrals.notifyChannel' },
    });
    const channel = (channelRow?.value as 'SMS' | 'EMAIL' | 'BOTH') ?? 'SMS';
    const useSms = channel === 'SMS' || channel === 'BOTH';
    const useEmail = channel === 'EMAIL' || channel === 'BOTH';

    const subject = `Clubify · ${eventLabel} · ${brandName}`;
    const htmlMessage = `<p>${eventLabel}</p><p><strong>Cliente:</strong> ${brandName}</p><p>${codeLine.replace(/\n/g, '<br>')}</p>`;

    const recipients: Array<{ phone?: string; email?: string; name: string }> = [
      { phone: direct.ownerWhatsapp, email: direct.ownerEmail, name: direct.ownerName },
    ];
    if (parent && (parent.ownerWhatsapp !== direct.ownerWhatsapp || parent.ownerEmail !== direct.ownerEmail)) {
      recipients.push({ phone: parent.ownerWhatsapp, email: parent.ownerEmail, name: parent.ownerName });
    }
    const adminPhone = await this.prisma.setting.findUnique({
      where: { key: 'salesWhatsapp' },
    });
    const adminEmail = await this.prisma.setting.findUnique({
      where: { key: 'salesEmail' },
    });
    if (adminPhone?.value || adminEmail?.value) {
      recipients.push({
        phone: adminPhone?.value,
        email: adminEmail?.value,
        name: 'Admin',
      });
    }

    for (const r of recipients) {
      if (useSms && r.phone) {
        await this.growBusiness.sendSms(tenantId, r.phone, message).catch(() => null);
      }
      if (useEmail && r.email) {
        await this.email
          .send({ to: r.email, subject, text: message, html: htmlMessage })
          .catch(() => null);
      }
    }
    this.logger.log(
      `Notificada cadena referidos (${event}, channel=${channel}): direct=${direct.code} parent=${parent?.code ?? '—'}`,
    );
  }

  /**
   * Fan-out post-PURCHASE_APPROVED:
   *   C2.1 — SMS al equipo comercial (Javier/Jhon) vía PreregAlertsService.
   *          Como DEFAULT_SUPPORT_SWITCH=2 ya está mergeado, el SMS sale
   *          automáticamente desde el número de soporte.
   *   C2.2 — CrmContact en el primer Stage del Pipeline del afiliado
   *          atribuido (si existe ReferralUse). El CRM de Clubify es
   *          per-afiliado (ownerUserId @unique en Pipeline), así que el
   *          contacto entra al kanban del usuario que trajo la venta.
   *   C2.3 — Event audit row con type='PURCHASE_APPROVED'.
   *
   * Cada paso captura sus errores con logger.warn — el caller envuelve
   * todo en .catch() también para defensa en profundidad.
   */
  private async postPurchaseFanOut(opts: {
    tenantId: string;
    brandName: string;
    nextCharge: Date;
    transactionId?: string;
  }) {
    const { tenantId, brandName, nextCharge, transactionId } = opts;

    // Datos extra del tenant para enriquecer la alerta + CrmContact.
    const fullTenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: {
        email: true,
        whatsappPhone: true,
        plan: { select: { name: true } },
      },
    });
    const planName = fullTenant?.plan?.name ?? 'Elite';
    const email = fullTenant?.email ?? '';
    const whatsappPhone = fullTenant?.whatsappPhone ?? null;

    // C2.1 — Alerta al equipo comercial.
    await this.alerts
      .sendTeamAlert(
        `🎉 Nueva compra Clubify\nCliente: ${brandName}\nEmail: ${email}\nPlan: ${planName}\nPróximo cobro: ${nextCharge.toLocaleDateString('es-CO')}`,
      )
      .catch((e) =>
        this.logger.warn(
          `sendTeamAlert post-purchase falló: ${(e as Error)?.message ?? e}`,
        ),
      );

    // C2.2 — CrmContact en el pipeline del afiliado atribuido. Si no hay
    // ReferralUse o el afiliado no tiene Pipeline/Stage, lo dejamos diferido
    // sin romper.
    try {
      const use = await this.prisma.referralUse.findFirst({
        where: {
          tenantId,
          referralCode: { role: { in: ['INFLUENCER', 'AMBASSADOR', 'VENDOR'] } },
        },
        orderBy: { createdAt: 'desc' },
        select: { referralCode: { select: { ownerUserId: true } } },
      });
      const ownerUserId = use?.referralCode?.ownerUserId ?? null;
      if (ownerUserId) {
        const firstStage = await this.prisma.stage.findFirst({
          where: { pipeline: { ownerUserId } },
          orderBy: { order: 'asc' },
          select: { id: true },
        });
        if (firstStage) {
          await this.prisma.crmContact.create({
            data: {
              ownerUserId,
              stageId: firstStage.id,
              name: brandName,
              phone: whatsappPhone,
              description: `Compra confirmada: ${nextCharge.toISOString()}\nEmail: ${email}\nPlan: ${planName}\nHotmart TX: ${transactionId ?? '—'}`,
              tags: ['compra_hotmart', planName].filter(Boolean) as any,
            },
          });
        } else {
          this.logger.log(
            `CrmContact post-purchase skip: afiliado ${ownerUserId} sin Stage configurada`,
          );
        }
      }
    } catch (e) {
      this.logger.warn(
        `CrmContact post-purchase falló: ${(e as Error)?.message ?? e}`,
      );
    }

    // C2.3 — Event audit row.
    await this.prisma.event
      .create({
        data: {
          tenantId,
          type: 'PURCHASE_APPROVED',
          payload: {
            plan: planName,
            hotmartTxId: transactionId ?? null,
            nextCharge: nextCharge.toISOString(),
          } as any,
        },
      })
      .catch((e) =>
        this.logger.warn(
          `Event audit PURCHASE_APPROVED falló: ${(e as Error)?.message ?? e}`,
        ),
      );
  }
}
