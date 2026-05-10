import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { GrowBusinessService } from '../integrations/grow-business.service';
import {
  smsPaymentConfirmed,
  smsPaymentFailed,
} from './billing-sms-templates';

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
      // Hotmart manda el monto pagado en USD acá. Lo usamos para calcular
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
  ) {}

  /** Helper: celular del dueño para SMS (user.phone → tenant.whatsappPhone → tenant.phone). */
  private async ownerPhone(tenantId: string): Promise<string | null> {
    const owner = await this.prisma.user.findFirst({
      where: { tenantId, role: 'TENANT_OWNER', isActive: true },
      select: { phone: true },
      orderBy: { createdAt: 'asc' },
    });
    if (owner?.phone) return owner.phone;
    const t = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { whatsappPhone: true, phone: true },
    });
    return t?.whatsappPhone ?? t?.phone ?? null;
  }

  /** Best-effort: manda SMS al dueño, no falla el webhook si no se puede. */
  private async notifyOwner(tenantId: string, brandName: string, message: string) {
    const phone = await this.ownerPhone(tenantId);
    if (!phone) return;
    const r = await this.growBusiness
      .sendSms(tenantId, phone, message)
      .catch((e) => ({ ok: false as const, message: e?.message }));
    if (r.ok) {
      this.logger.log(`SMS Hotmart enviado a ${brandName} (${phone})`);
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
        await this.generateReferralCommission({
          tenantId: tenant.id,
          paidAmount: payload.data?.purchase?.price?.value ?? null,
          transactionId,
        }).catch((e) => {
          this.logger.warn(`generateReferralCommission falló: ${(e as Error).message}`);
        });
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

      case 'PURCHASE_DELAYED':
      case 'PURCHASE_PROTEST':
      case 'PURCHASE_BILLET_PRINTED': {
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
      const user = await this.prisma.user.findFirst({
        where: { email: buyerEmail, role: 'TENANT_OWNER', tenantId: { not: null } },
        select: { tenantId: true },
      });
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
   * Construye la URL de checkout según el plan del tenant.
   * Las env vars son:
   *   HOTMART_PRODUCT_ID_ELITE  → producto del plan Elite ($50)
   *   HOTMART_PRODUCT_ID_PRO    → producto del plan Pro ($99) — opcional
   *   HOTMART_PRODUCT_ID        → fallback genérico si no hay match por plan
   *   HOTMART_OFFER_CODE_<PLAN> → opcional, `off=` para offers específicas
   *   HOTMART_BID_<PLAN>        → opcional, `bid=` para tracking de oferta/bid
   */
  buildCheckoutUrl(opts: { email?: string; planName?: string }) {
    const productId = this.resolveProductId(opts.planName);
    if (!productId) return null;
    const offerCode = this.resolveOfferCode(opts.planName);
    const bid = this.resolveBid(opts.planName);
    const base = `https://pay.hotmart.com/${productId}`;
    const params = new URLSearchParams();
    if (offerCode) params.set('off', offerCode);
    if (bid) params.set('bid', bid);
    if (opts.email) params.set('email', opts.email);
    const qs = params.toString();
    return qs ? `${base}?${qs}` : base;
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

  /** "Elite" → "ELITE", "Pro" → "PRO". Acepta también el nombre antiguo. */
  private planKey(planName?: string): string | undefined {
    if (!planName) return undefined;
    const n = planName.toLowerCase().trim();
    if (n === 'elite') return 'ELITE';
    if (n === 'pro' || n.includes('automatizaciones') || n.includes('whatsapp')) return 'PRO';
    return undefined;
  }

  isConfigured(): boolean {
    const hasAnyProduct =
      !!process.env.HOTMART_PRODUCT_ID ||
      !!process.env.HOTMART_PRODUCT_ID_ELITE ||
      !!process.env.HOTMART_PRODUCT_ID_PRO;
    return hasAnyProduct && !!process.env.HOTMART_HOTTOK;
  }

  // ============================================================
  //   Comisiones de referidos — automatización (Fase 1)
  // ============================================================

  /**
   * Genera una Commission para el ReferralUse asociado al tenant cuando
   * Hotmart confirma un pago. Idempotente:
   *   - Si la última Commission del use es < 25 días → skip (mismo ciclo)
   *   - Si no hay ReferralUse para el tenant → no-op
   *
   * Marca también el ReferralUse como PAYING (la primera vez) para que el
   * leaderboard cuente conversión real, no sólo signup.
   *
   * Monto: paidAmount del payload si vino, sino plan.priceMonthly del tenant.
   * % de comisión: ReferralCode.commissionPercent (default 25%).
   */
  private async generateReferralCommission(opts: {
    tenantId: string;
    paidAmount: number | null;
    transactionId?: string;
  }) {
    const use = await this.prisma.referralUse.findFirst({
      where: { tenantId: opts.tenantId },
      include: {
        referralCode: { select: { commissionPercent: true } },
        commissions: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (!use) return; // tenant sin referido — no hay comisión que generar

    // Resolver monto pagado: payload Hotmart > plan.priceMonthly
    let amountPaid = opts.paidAmount;
    if (!amountPaid || amountPaid <= 0) {
      const tenant = await this.prisma.tenant.findUnique({
        where: { id: opts.tenantId },
        select: { plan: { select: { priceMonthly: true } } },
      });
      amountPaid = Number(tenant?.plan?.priceMonthly ?? 0);
    }
    if (!amountPaid || amountPaid <= 0) {
      this.logger.warn(
        `Skip comisión: sin precio para tenant=${opts.tenantId}`,
      );
      return;
    }

    const pct = Number(use.referralCode.commissionPercent ?? 25);
    const commissionAmount = Math.round((amountPaid * pct) / 100 * 100) / 100;

    // Idempotencia: si la última comisión es muy reciente (mismo ciclo
    // mensual), no creamos otra. Hotmart a veces re-envía webhooks.
    const last = use.commissions[0];
    if (last) {
      const daysSince = (Date.now() - new Date(last.createdAt).getTime()) / 86400_000;
      if (daysSince < 25) {
        this.logger.log(
          `Skip comisión duplicada: tenant=${opts.tenantId} última=${daysSince.toFixed(1)}d`,
        );
        return;
      }
    }

    // Promover a PAYING si está SIGNED_UP (primer pago confirmado).
    if (use.status === 'SIGNED_UP') {
      await this.prisma.referralUse.update({
        where: { id: use.id },
        data: { status: 'PAYING', convertedAt: new Date() },
      });
    }

    await this.prisma.commission.create({
      data: {
        referralUseId: use.id,
        amount: commissionAmount,
        status: 'PENDING', // pasa a APPROVED automáticamente a los 30d
      },
    });
    this.logger.log(
      `Comisión generada: tenant=${opts.tenantId} use=${use.id} $${commissionAmount} (${pct}% de $${amountPaid})`,
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
}
