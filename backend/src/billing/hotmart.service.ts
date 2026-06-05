import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { GrowBusinessService } from '../integrations/grow-business.service';
import { EmailService } from '../email/email.service';
import { BillingService } from './billing.service';
import { ReferralsService } from '../referrals/referrals.service';
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
      this.logger.warn(
        `Hotmart event ${event}: no tenant matched (email=${buyerEmail} subscriber=${subscriberCode})`,
      );
      return { ok: true, action: 'tenant_not_found' };
    }

    switch (event) {
      case 'PURCHASE_APPROVED':
      case 'PURCHASE_COMPLETE': {
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
        return { ok: true, action: 'activated' };
      }

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

    // Sin descuentos: comisiones siempre sobre el precio del plan. Si
    // Hotmart cobró menos por alguna razón (impuesto, conversión, etc),
    // referido y socio igual cobran sobre la tarifa lista. La diferencia
    // la absorbe la empresa.
    const referralBase = originalPrice;
    const socioBase = originalPrice;
    void amountPaid;

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
        const pct = Number(use.referralCode.commissionPercent ?? 25);
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
          const indirectPct = await this.getNumberSetting('referrals.indirectPercent', 5);
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
}
