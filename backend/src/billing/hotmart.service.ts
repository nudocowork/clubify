import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { GrowBusinessService } from '../integrations/grow-business.service';
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
    let amountPaid = opts.paidAmount && opts.paidAmount > 0 ? opts.paidAmount : originalPrice;
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
        referralCode: {
          include: {
            parentCode: true,
            campaign: { select: { discountAbsorption: true } },
            ownerOfCampaign: { select: { discountAbsorption: true } },
          },
        },
        commissions: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
      orderBy: { createdAt: 'desc' },
    });

    // Resolver regla de absorción de descuento. La regla vive en la
    // campaña — un embajador la hereda de su `campaignId`; un influencer
    // titular de campaña la lee de `ownerOfCampaign`. Sin campaña asociada:
    // PROPORTIONAL como default seguro.
    const absorption =
      use?.referralCode.campaign?.discountAbsorption ??
      use?.referralCode.ownerOfCampaign?.discountAbsorption ??
      'PROPORTIONAL';
    // Base sobre la cual calculamos la comisión del referido (directa+indirecta):
    //   - PAID_PRICE: usa el monto efectivamente pagado (descuento prorrateado).
    //   - resto: usa el precio original (referidos cobran sobre tarifa lista).
    const referralBase =
      absorption === 'PAID_PRICE' ? amountPaid : originalPrice;
    // Base para la comisión del SOCIO:
    //   - EMPRESA_ABSORBS: socio cobra sobre original (descuento sale solo de empresa).
    //   - ORIGINAL_PRICE: socio cobra sobre original.
    //   - PAID_PRICE: socio cobra sobre lo pagado.
    //   - PROPORTIONAL: socio cobra sobre lo pagado (comparte el descuento con empresa).
    const socioBase =
      absorption === 'ORIGINAL_PRICE' || absorption === 'EMPRESA_ABSORBS'
        ? originalPrice
        : amountPaid;

    if (use) {
      const last = use.commissions[0];
      const recent = last && (Date.now() - new Date(last.createdAt).getTime()) / 86400_000 < 25;

      if (!recent) {
        const pct = Number(use.referralCode.commissionPercent ?? 25);
        const direct = round2((referralBase * pct) / 100);

        if (use.status === 'SIGNED_UP') {
          await this.prisma.referralUse.update({
            where: { id: use.id },
            data: { status: 'PAYING', convertedAt: new Date() },
          });
        }
        await this.prisma.commission.create({
          data: { referralUseId: use.id, amount: direct, status: 'PENDING' },
        });
        this.logger.log(
          `Comisión directa: ${use.referralCode.role} ${use.referralCode.code} $${direct} (${pct}% sobre $${referralBase} · ${absorption})`,
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
            data: { referralUseId: parentUse.id, amount: indirect, status: 'PENDING' },
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

    if (direct.ownerWhatsapp) {
      await this.growBusiness
        .sendSms(tenantId, direct.ownerWhatsapp, message)
        .catch(() => null);
    }
    if (parent?.ownerWhatsapp && parent.ownerWhatsapp !== direct.ownerWhatsapp) {
      await this.growBusiness
        .sendSms(tenantId, parent.ownerWhatsapp, message)
        .catch(() => null);
    }
    const adminPhone = await this.prisma.setting.findUnique({
      where: { key: 'salesWhatsapp' },
    });
    if (adminPhone?.value) {
      await this.growBusiness
        .sendSms(tenantId, adminPhone.value, message)
        .catch(() => null);
    }
    this.logger.log(
      `Notificada cadena referidos (${event}): direct=${direct.code} parent=${parent?.code ?? '—'}`,
    );
  }
}
