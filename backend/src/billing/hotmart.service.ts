import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../common/prisma/prisma.service';
import { GrowBusinessService } from '../integrations/grow-business.service';
import { EmailService } from '../email/email.service';
import { BillingService } from './billing.service';
import { ReferralsService } from '../referrals/referrals.service';
import { PreregAlertsService } from '../auth/prereg-alerts.service';
import { CommissionExceptionsService } from '../admin/commission-exceptions.service';
import { monthKey } from '../common/period-key';
import { COMMISSION_DEFAULTS } from '../common/commission-defaults';
import { addPlanPeriod } from '../common/plan-period';
import { SmsTemplatesService } from './sms-templates.service';
import { WhiteLabelNotificationsService } from '../white-label-notifications/white-label-notifications.service';
import { BusinessGroupsService } from '../business-groups/business-groups.service';
import { fmtSmsDate } from './sms-templates';
import { decryptSecret } from '../common/crypto/secret-box';

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Aislamiento por marca para la búsqueda del tenant en el webhook.
 *  includeNull=true incluye tenants sin marca (whiteLabelId null = histórico
 *  Clubify); las marcas blancas usan false (estricto a su id). */
type TenantScope = { whiteLabelId: string; includeNull: boolean };

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
      // Oferta específica del checkout. Varias ofertas pueden compartir el mismo
      // productId (ej. packs de 1/10/20 créditos) → el offer.code distingue cuál.
      offer?: { code?: string; description?: string };
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
    private smsTemplates: SmsTemplatesService,
    private wlNotifications: WhiteLabelNotificationsService,
    private businessGroups: BusinessGroupsService,
  ) {}

  /** Precio canónico del bundle en USD (68/150/278/500) según periodicidad,
   *  con override por Setting `landing.plans.<period>.price`. Replica
   *  CommissionRecalcService.getBundlePrice vía prisma para no acoplar este
   *  módulo (evita ciclos de DI). Devuelve 0 si no se puede resolver. */
  private async getCanonicalBundlePrice(
    periodicity: string | null,
  ): Promise<number> {
    const DEFAULTS: Record<string, number> = {
      MENSUAL: 68,
      TRIMESTRAL: 150,
      SEMESTRAL: 278,
      ANUAL: 500,
    };
    const period = (periodicity ?? 'MENSUAL').toUpperCase();
    const key = `landing.plans.${period.toLowerCase()}.price`;
    const row = await this.prisma.setting.findUnique({ where: { key } });
    const fromSetting = row?.value != null ? Number(row.value) : NaN;
    if (Number.isFinite(fromSetting) && fromSetting > 0) return fromSetting;
    return DEFAULTS[period] ?? 0;
  }

  /**
   * Bug #10 (currency Hotmart): extrae el monto pagado en USD del payload,
   * validándolo contra el precio canónico del plan.
   *
   * Hotmart manda `purchase.price.value` en la MONEDA del producto/oferta y
   * en producción NO está enviando `currency_code` — así que el value puede
   * venir en USD (148.55 ≈ 150) o en moneda local (541498 COP ≈ 150 USD,
   * o ~2700 MXN, ~750 BRL). Tratarlo siempre como USD infla
   * `subscriptionPriceUsd` y la base de comisiones (caso real: comisión de
   * $54k sobre 541498).
   *
   * Política:
   *  - currency_code explícito != USD → no es base USD (null).
   *  - sin ancla canónica → guarda absoluta (ningún plan supera ~600 USD).
   *  - con ancla canónica → aceptamos el value como USD solo si cae en una
   *    banda razonable [0.3x, 1.6x] del canónico (cupón abajo / fees arriba).
   *    Fuera de banda = moneda local → null (el caller usa el canónico).
   */
  private resolvePaidUsd(
    payload: HotmartWebhookPayload,
    ctx: string,
    canonicalUsd: number,
  ): number | null {
    const price = payload?.data?.purchase?.price;
    const value = price?.value;
    if (typeof value !== 'number' || value <= 0) return null;

    const ccy = (price?.currency_code || '').toUpperCase();
    if (ccy && ccy !== 'USD') {
      this.logger.warn(
        `Hotmart ${ctx}: value=${value} en ${ccy} (no USD) — uso canónico ${canonicalUsd}.`,
      );
      return null;
    }

    if (canonicalUsd > 0) {
      const lo = canonicalUsd * 0.3;
      const hi = canonicalUsd * 1.6;
      if (value < lo || value > hi) {
        this.logger.warn(
          `Hotmart ${ctx}: value=${value} fuera de banda USD [${lo.toFixed(0)},${hi.toFixed(0)}] del plan ${canonicalUsd} — probable moneda local, uso canónico.`,
        );
        return null;
      }
      return value;
    }

    // Sin ancla: ningún plan legítimo supera ~600 USD.
    if (value > 600) {
      this.logger.warn(
        `Hotmart ${ctx}: value=${value} > 600 sin ancla canónica — probable moneda local, ignoro.`,
      );
      return null;
    }
    return value;
  }

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
   * Verifica el HOTTOK contra el webhookSecret CIFRADO de una marca (ruta
   * brand-aware /webhooks/hotmart/:slug). La marca debe estar ACTIVE y tener
   * paymentGateway=HOTMART con un webhookSecret cargado. Devuelve el
   * whiteLabelId si valida, o null. NO cae al env: cada marca usa su secreto.
   */
  async verifyHottokForBrand(
    slug: string,
    hottok?: string,
  ): Promise<{ whiteLabelId: string } | null> {
    const s = (slug ?? '').trim().toLowerCase();
    if (!s) return null;
    const wl = await this.prisma.whiteLabel.findFirst({
      where: { slug: s, status: 'ACTIVE' },
      select: { id: true, paymentGateway: true, paymentConfig: true },
    });
    if (!wl || wl.paymentGateway !== 'HOTMART') return null;
    const cfg = (wl.paymentConfig as Record<string, any>) || {};
    const enc = cfg.webhookSecret as string | undefined;
    if (!enc) return null;
    let secret: string;
    try {
      secret = decryptSecret(enc);
    } catch {
      return null;
    }
    return hottok && hottok === secret ? { whiteLabelId: wl.id } : null;
  }

  /** Scope del webhook legacy (/webhooks/hotmart = Clubify): tenants de la
   *  marca clubify O sin marca (whiteLabelId null = histórico Clubify).
   *  Excluye tenants de OTRAS marcas. Si no existe el registro clubify,
   *  devuelve undefined → comportamiento global (no rompe nada). */
  async clubifyScope(): Promise<TenantScope | undefined> {
    const wl = await this.prisma.whiteLabel.findFirst({
      where: { slug: 'clubify' },
      select: { id: true },
    });
    return wl ? { whiteLabelId: wl.id, includeNull: true } : undefined;
  }

  /**
   * Procesa el payload del webhook. Devuelve `{ ok, action }` describiendo
   * qué se hizo. NO lanza errores al caller; loggea y persiste para debugging
   * porque Hotmart reintenta agresivamente y queremos 200 idempotente.
   *
   * `scope` aísla la búsqueda del tenant a una marca: la ruta /:slug pasa el
   * whiteLabelId de la marca (estricto); la legacy pasa el scope de Clubify
   * (id clubify + null). Un pago de una marca NUNCA activa el tenant de otra.
   */
  async handleEvent(payload: HotmartWebhookPayload, scope?: TenantScope) {
    const event = payload.event;
    const buyerEmail = payload.data?.buyer?.email?.toLowerCase();
    const subscriberCode = payload.data?.subscription?.subscriber?.code;
    const transactionId = payload.data?.purchase?.transaction;

    this.logger.log(
      `Hotmart event=${event} buyer=${buyerEmail} subscriber=${subscriberCode} tx=${transactionId}`,
    );

    if (!event) return { ok: true, action: 'no_event' };

    // E (2026-06-12): event-level idempotency. Hotmart reintenta
    // agresivamente — el mismo webhook puede llegar 3-5 veces. Antes la
    // dedup era por externalTxId en Commission y por window de 25 días.
    // Ahora persistimos el id del evento y rechazamos los retries.
    //
    // FIX 2026-06-12 (race condition): el patrón anterior era
    // check→run→mark, lo que permitía que dos retries simultáneos
    // pasaran ambos el check, corrieran activatePurchase dos veces y
    // crearan commissions/SMS duplicados. Ahora reclamamos el eventId
    // ANTES de correr la lógica (atomic INSERT + catch P2002). Si la
    // lógica falla después, el evento queda marcado igualmente y los
    // retries de Hotmart no re-disparan side effects — la falla
    // requiere intervención manual (igual que antes, porque el caller
    // siempre devolvía 200).
    const eventId = this.computeEventId(payload);
    const claimed = await this.claimEvent(eventId, event, payload);
    if (!claimed) {
      this.logger.log(
        `Hotmart event ${eventId} (${event}) ya procesado — skip duplicate`,
      );
      return { ok: true, action: 'duplicate_event' };
    }

    // Master Admin: si el productId del payload matchea un HotmartCreditLink,
    // es un pack de créditos (no una suscripción de negocio). Lo manejamos
    // ACÁ, antes de findTenant, porque las marcas blancas no tienen tenant.
    if (event === 'PURCHASE_APPROVED' || event === 'PURCHASE_COMPLETE') {
      const creditHandled = await this.tryHandleCreditPurchase(payload).catch((e) => {
        this.logger.error(`tryHandleCreditPurchase falló: ${(e as Error)?.message}`);
        return null;
      });
      if (creditHandled) {
        return { ok: true, action: creditHandled };
      }
    }

    // Master Admin: refund/chargeback de pack de créditos. Si el
    // transactionId matchea una HotmartCreditPurchase ASSIGNED, revertimos
    // los créditos a la marca y marcamos la compra como REFUNDED.
    if (event === 'PURCHASE_REFUNDED' || event === 'PURCHASE_CHARGEBACK') {
      const refundHandled = await this.tryHandleCreditRefund(payload).catch((e) => {
        this.logger.error(`tryHandleCreditRefund falló: ${(e as Error)?.message}`);
        return null;
      });
      if (refundHandled) {
        return { ok: true, action: refundHandled };
      }
    }

    // Grupo Empresarial: si el subscriberCode (o el email del responsable en el
    // primer pago) matchea un grupo, el cobro es del GRUPO → activamos/suspendemos
    // el grupo y cascadea a TODOS sus negocios. No hay un tenant único.
    const nextChargeRaw = payload.data?.subscription?.date_next_charge;
    const groupAction = await this.businessGroups
      .tryHandleHotmartEvent({
        event,
        subscriberCode,
        buyerEmail,
        nextChargeDate: nextChargeRaw ? new Date(nextChargeRaw) : null,
      })
      .catch((e) => {
        this.logger.error(`group hotmart handler falló: ${(e as Error)?.message}`);
        return null;
      });
    if (groupAction) {
      this.logger.log(`Hotmart event ${event} → grupo: ${groupAction}`);
      return { ok: true, action: groupAction };
    }

    // Localizar tenant por email del buyer (caso primer pago) o por subscriberCode (renovaciones).
    // Scopeado a la marca: nunca matchea tenants de otra marca.
    const tenant = await this.findTenant({ buyerEmail, subscriberCode, scope });
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

    // Actualizar tenantId en el evento ya reclamado (mejor traceability).
    await this.prisma.hotmartWebhookEvent
      .update({ where: { eventId }, data: { tenantId: tenant.id } })
      .catch(() => null);

    return this.runEventLogic(event, tenant, payload);
  }

  /** Computa un eventId determinístico para event-level idempotency.
   *  FIX 2026-06-12 (colisión): el fallback antes era
   *  `derived:EVENT:TX:SUB`. Si Hotmart NO mandaba `id`, `transaction`
   *  ni `subscriber.code` (primer pago de dos clientes distintos del
   *  mismo producto), el fallback se reducía a `derived:EVENT::` para
   *  ambos → el segundo cliente quedaba marcado como duplicado y sin
   *  activarse. Ahora incluimos buyerEmail + approved_date como
   *  desambiguadores estables. */
  private computeEventId(payload: HotmartWebhookPayload): string {
    const raw = (payload as any).id;
    if (typeof raw === 'string' && raw.length > 0) return raw;
    const event = payload.event ?? 'unknown';
    const tx = payload.data?.purchase?.transaction ?? '';
    const sub = payload.data?.subscription?.subscriber?.code ?? '';
    const buyer = payload.data?.buyer?.email?.toLowerCase() ?? '';
    const approved = payload.data?.purchase?.approved_date ?? '';
    return `derived:${event}:${tx}:${sub}:${buyer}:${approved}`;
  }

  /** Atomically claim el eventId antes de correr lógica. Retorna true si
   *  ganamos el INSERT (procesar), false si ya estaba (duplicate).
   *  El UNIQUE(eventId) garantiza que solo un retry pase aunque dos
   *  webhooks lleguen al mismo tiempo. */
  private async claimEvent(
    eventId: string,
    eventType: string,
    payload: HotmartWebhookPayload,
  ): Promise<boolean> {
    try {
      await this.prisma.hotmartWebhookEvent.create({
        data: {
          eventId,
          eventType,
          payload: payload as any,
        },
      });
      return true;
    } catch (e) {
      if ((e as any)?.code === 'P2002') return false;
      // Otro error de DB — loggeamos pero dejamos pasar para que la
      // lógica corra (preferimos un dup raro sobre perder un pago).
      this.logger.error(
        `claimEvent falló para ${eventId}: ${(e as Error)?.message}`,
      );
      return true;
    }
  }

  /**
   * Master Admin (2026-06-14): si el productId del payload matchea un
   * HotmartCreditLink registrado, acreditamos automáticamente los créditos
   * a la marca blanca correspondiente.
   *
   * Estrategia de matching de marca: por orden de precedencia
   *   1) buyer.email coincide (insensitive) con `WhiteLabel.adminEmail`
   *   2) buyer.email coincide con un User PLATFORM_OWNER (compra hecha
   *      por el operador de la plataforma → asignar a alguna marca via
   *      reasignación manual; por ahora queda UNASSIGNED)
   *   3) Sin match → guarda UNASSIGNED para reasignación desde
   *      /superadmin/creditos.
   *
   * Idempotency: transactionId UNIQUE en HotmartCreditPurchase. Si ya
   * existe → devuelve 'credit_purchase_duplicate' (no duplica créditos).
   *
   * Devuelve string con la acción si la compra fue tratada como pack de
   * créditos, o null si NO matchea ningún productId (sigue al flujo
   * normal de suscripción de tenant).
   */
  async tryHandleCreditPurchase(payload: HotmartWebhookPayload): Promise<string | null> {
    const productIdRaw = payload.data?.product?.id;
    if (productIdRaw === undefined || productIdRaw === null) return null;
    const productId = String(productIdRaw);
    const offerCode = payload.data?.purchase?.offer?.code?.trim() || null;
    const buyerEmail = payload.data?.buyer?.email?.toLowerCase();
    const transactionId =
      payload.data?.purchase?.transaction ?? `derived:${productId}:${buyerEmail ?? '?'}`;

    // Todos los links ACTIVOS de este producto. Varias ofertas (1/10/20) pueden
    // compartir productId → desambiguamos por offer.code.
    const productLinks = await this.prisma.hotmartCreditLink.findMany({
      where: { hotmartProductId: productId, isActive: true },
    });
    if (productLinks.length === 0) return null; // no es pack de créditos

    this.logger.log(
      `[CREDITOS] WEBHOOK RECIBIDO · tx=${transactionId} producto=${productId} ` +
        `offer=${offerCode ?? '-'} buyer=${buyerEmail ?? '-'} ` +
        `links_del_producto=${productLinks.length}`,
    );

    // Selección del link: 1) match exacto por offerCode; 2) si hay UN solo link
    // del producto, usarlo (producto de oferta única); 3) ambiguo (varios links,
    // sin match de oferta) → ERROR + UNASSIGNED, NO acreditar cantidad al azar.
    let creditLink = offerCode
      ? productLinks.find((l) => l.hotmartOfferCode === offerCode) ?? null
      : null;
    if (!creditLink) {
      if (productLinks.length === 1) {
        creditLink = productLinks[0];
      } else {
        this.logger.error(
          `[CREDITOS] ERROR: producto ${productId} tiene ${productLinks.length} links y la ` +
            `oferta '${offerCode ?? '(sin offer en payload)'}' no matchea ninguno. ` +
            `No se puede determinar la cantidad → registro UNASSIGNED. ` +
            `Asigná hotmartOfferCode a cada HotmartCreditLink.`,
        );
        await this.prisma.hotmartCreditPurchase
          .create({
            data: {
              transactionId,
              hotmartProductId: productId,
              creditLinkId: productLinks[0].id,
              credits: 0,
              buyerEmail: buyerEmail ?? '',
              status: 'UNASSIGNED',
              rawPayload: payload as any,
            },
          })
          .catch(() => null);
        return 'credit_purchase_offer_ambiguous';
      }
    }
    this.logger.log(
      `[CREDITOS] PRODUCTO IDENTIFICADO · link="${creditLink.label}" ` +
        `créditos=${creditLink.credits} offerCode=${creditLink.hotmartOfferCode ?? '-'}`,
    );

    // Idempotency vía transactionId UNIQUE.
    const existing = await this.prisma.hotmartCreditPurchase.findUnique({
      where: { transactionId },
    });
    if (existing) {
      this.logger.log(
        `[CREDITOS] tx=${transactionId} ya procesada (status=${existing.status}) — skip duplicate`,
      );
      return 'credit_purchase_duplicate';
    }

    // Marca propietaria por RELACIÓN DIRECTA del link (product+offer → marca).
    // 2026-06-23: YA NO se identifica por el correo del comprador — una marca
    // puede comprar con cualquier email. El email queda SOLO informativo.
    // El link define la marca (creditLink.whiteLabelId) y la cantidad. Legacy:
    // link sin whiteLabelId → default Clubify (los links viejos son de Clubify).
    let whiteLabelId: string | null = creditLink.whiteLabelId ?? null;
    if (!whiteLabelId) {
      const clubify = await this.prisma.whiteLabel.findFirst({
        where: { slug: 'clubify' },
        select: { id: true },
      });
      whiteLabelId = clubify?.id ?? null;
    }
    let creditsUnlimited = false;
    if (whiteLabelId) {
      const wl = await this.prisma.whiteLabel.findUnique({
        where: { id: whiteLabelId },
        select: { id: true, creditsUnlimited: true },
      });
      if (wl) {
        creditsUnlimited = wl.creditsUnlimited;
      } else {
        whiteLabelId = null; // id colgado / marca borrada → UNASSIGNED
      }
    }
    this.logger.log(
      `[CREDITOS] MARCA BLANCA IDENTIFICADA (por link, no email) · ` +
        `whiteLabelId=${whiteLabelId ?? 'NINGUNA (→ UNASSIGNED)'} unlimited=${creditsUnlimited} ` +
        `buyer(informativo)=${buyerEmail ?? '-'}`,
    );

    if (!whiteLabelId) {
      // Sin match — guardamos UNASSIGNED para reasignación manual.
      await this.prisma.hotmartCreditPurchase.create({
        data: {
          transactionId,
          hotmartProductId: productId,
          creditLinkId: creditLink.id,
          credits: creditLink.credits,
          buyerEmail: buyerEmail ?? '',
          status: 'UNASSIGNED',
          rawPayload: payload as any,
        },
      });
      this.logger.warn(
        `[CREDITOS] ERROR: tx=${transactionId} sin marca (buyer=${buyerEmail} no matchea ` +
          `ningún adminEmail ni User SUPER_ADMIN) → UNASSIGNED. Asignar desde /superadmin/creditos.`,
      );
      return 'credit_purchase_unassigned';
    }

    // Match: registra la compra como ASSIGNED. Si la marca tiene
    // créditos ilimitados, NO incrementamos creditsAvailable ni creamos
    // CreditTransaction — la marca sigue sin caducar.
    if (creditsUnlimited) {
      await this.prisma.hotmartCreditPurchase.create({
        data: {
          transactionId,
          hotmartProductId: productId,
          creditLinkId: creditLink.id,
          credits: creditLink.credits,
          buyerEmail: buyerEmail ?? '',
          whiteLabelId,
          status: 'ASSIGNED',
          assignedAt: new Date(),
          rawPayload: payload as any,
        },
      });
      this.logger.log(
        `Hotmart credit purchase ${transactionId}: marca ${whiteLabelId} es ilimitada, compra registrada sin incrementar`,
      );
      return 'credit_purchase_unlimited';
    }
    // CRÉDITOS ANTES (para log + trazabilidad).
    const beforeWl = await this.prisma.whiteLabel.findUnique({
      where: { id: whiteLabelId },
      select: { creditsAvailable: true },
    });
    this.logger.log(
      `[CREDITOS] CRÉDITOS A ACREDITAR=${creditLink.credits} · CRÉDITOS ANTES=${beforeWl?.creditsAvailable ?? '?'}`,
    );
    const [, updatedWl] = await this.prisma.$transaction([
      this.prisma.hotmartCreditPurchase.create({
        data: {
          transactionId,
          hotmartProductId: productId,
          creditLinkId: creditLink.id,
          credits: creditLink.credits,
          buyerEmail: buyerEmail ?? '',
          whiteLabelId,
          status: 'ASSIGNED',
          assignedAt: new Date(),
          rawPayload: payload as any,
        },
      }),
      this.prisma.whiteLabel.update({
        where: { id: whiteLabelId },
        data: { creditsAvailable: { increment: creditLink.credits } },
        select: { creditsAvailable: true },
      }),
      this.prisma.creditTransaction.create({
        data: {
          whiteLabelId,
          type: 'PURCHASE',
          amount: creditLink.credits,
          note: `Compra Hotmart · ${creditLink.label} · tx=${transactionId}`,
        },
      }),
    ]);

    this.logger.log(
      `[CREDITOS] ✅ ACREDITADO · tx=${transactionId} · ${creditLink.credits} créditos → marca ${whiteLabelId} · ` +
        `CRÉDITOS DESPUÉS=${updatedWl.creditsAvailable}`,
    );
    // SMS a la marca: créditos acreditados (+ reset de dedups de avisos).
    const fresh = { creditsAvailable: updatedWl.creditsAvailable };
    await this.wlNotifications
      .onCreditsPurchased(whiteLabelId, creditLink.credits, fresh?.creditsAvailable ?? creditLink.credits)
      .catch(() => null);
    return 'credit_purchase_assigned';
  }

  /**
   * Master Admin (2026-06-14): refund/chargeback de pack de créditos.
   * Si el transactionId del payload matchea una HotmartCreditPurchase
   * previamente registrada, revertimos los créditos a la marca y marcamos
   * la compra como REFUNDED.
   *
   * Devuelve string con la acción, o null si:
   *  - La transacción no corresponde a un pack de créditos
   *  - La compra ya estaba REFUNDED (idempotency)
   */
  async tryHandleCreditRefund(payload: HotmartWebhookPayload): Promise<string | null> {
    const transactionId = payload.data?.purchase?.transaction;
    if (!transactionId) return null;

    const purchase = await this.prisma.hotmartCreditPurchase.findUnique({
      where: { transactionId },
      include: { whiteLabel: { select: { creditsUnlimited: true, name: true } } },
    });
    if (!purchase) return null; // no es un pack de créditos
    if (purchase.status === 'REFUNDED') {
      this.logger.log(
        `Hotmart credit refund ${transactionId} ya procesado — skip duplicate`,
      );
      return 'credit_refund_duplicate';
    }

    // Si nunca llegó a estar ASSIGNED (UNASSIGNED legacy o que nunca se
    // matcheó), solo marcamos como REFUNDED sin reversar nada.
    if (purchase.status !== 'ASSIGNED' || !purchase.whiteLabelId) {
      await this.prisma.hotmartCreditPurchase.update({
        where: { id: purchase.id },
        data: { status: 'REFUNDED' },
      });
      this.logger.log(
        `Hotmart credit refund ${transactionId}: compra estaba ${purchase.status}, sin reversar créditos`,
      );
      return 'credit_refund_no_op';
    }

    // Marcas ilimitadas: solo marcamos REFUNDED. No hubo incremento original.
    if (purchase.whiteLabel?.creditsUnlimited) {
      await this.prisma.hotmartCreditPurchase.update({
        where: { id: purchase.id },
        data: { status: 'REFUNDED' },
      });
      this.logger.log(
        `Hotmart credit refund ${transactionId}: marca ${purchase.whiteLabel.name} es ilimitada, solo marcamos REFUNDED`,
      );
      return 'credit_refund_unlimited';
    }

    // Reverso real: decremento creditsAvailable + creditsUsed -= credits + CreditTransaction REFUND.
    await this.prisma.$transaction([
      this.prisma.hotmartCreditPurchase.update({
        where: { id: purchase.id },
        data: { status: 'REFUNDED' },
      }),
      this.prisma.whiteLabel.update({
        where: { id: purchase.whiteLabelId },
        data: {
          creditsAvailable: { decrement: purchase.credits },
        },
      }),
      this.prisma.creditTransaction.create({
        data: {
          whiteLabelId: purchase.whiteLabelId,
          type: 'REFUND',
          amount: -purchase.credits,
          note: `Refund/chargeback Hotmart · tx=${transactionId}`,
        },
      }),
    ]);

    this.logger.log(
      `Hotmart credit refund ${transactionId}: -${purchase.credits} créditos a marca ${purchase.whiteLabelId}`,
    );
    return 'credit_refund_processed';
  }

  /** Switch principal — extraído para que handleEvent pueda
   *  wrappear con el markEventProcessed. */
  private async runEventLogic(
    event: HotmartEventType,
    tenant: Awaited<ReturnType<typeof this.findTenant>>,
    payload: HotmartWebhookPayload,
  ) {
    if (!tenant) return { ok: true, action: 'tenant_not_found' as const };
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
        this.smsTemplates
          .render('payment_failed', { brandName: tenant.brandName })
          .then((msg) =>
            this.notifyOwner(tenant.id, tenant.brandName, msg),
          )
          .catch(() => null);
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
        const transactionId = payload.data?.purchase?.transaction;
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
          transactionId: transactionId ?? null,
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
      status?: string;
      hotmartSubscriberCode: string | null;
      hotmartTransactionId: string | null;
      currentPeriodEnd?: Date | null;
    },
    payload: HotmartWebhookPayload,
  ) {
    const wasSuspended = tenant.status === 'SUSPENDED';
    const subscriberCode = payload.data?.subscription?.subscriber?.code;
    const transactionId = payload.data?.purchase?.transaction;
    // E (2026-06-12): Hotmart es la fuente oficial de fechas. Si
    // date_next_charge NO viene en una RENOVACIÓN, NO inventamos +30
    // días — preservamos currentPeriodEnd existente. Antes el +30 local
    // pisaba renovaciones legítimas con fechas incorrectas.
    //
    // FIX 2026-06-12 (primer pago): si es PRIMER pago (no hay
    // currentPeriodEnd existente) y Hotmart tampoco lo envía, sí
    // hacemos fallback a +30 días — sino el tenant queda sin fecha de
    // próximo cobro PERMANENTEMENTE y el cron de billing nunca le manda
    // recordatorios. El usuario puede ajustar a mano después.
    // Periodicidad del plan — necesaria para calcular el próximo cobro real
    // (bug #1) y para validar el monto USD (bug #10).
    const planForBase = await this.prisma.tenant.findUnique({
      where: { id: tenant.id },
      select: { planPeriodicity: true },
    });
    const nextChargeRaw = payload.data?.subscription?.date_next_charge;
    let nextCharge = nextChargeRaw ? new Date(nextChargeRaw) : null;
    if (!nextCharge && !tenant.currentPeriodEnd) {
      // Bug #1: el fallback debe respetar la periodicidad real del plan
      // (Trimestral = +3 meses, no +30 días fijos). Antes siempre sumaba 30d.
      nextCharge = addPlanPeriod(new Date(), planForBase?.planPeriodicity);
      this.logger.warn(
        `activatePurchase tenant=${tenant.id}: primer pago sin date_next_charge — fallback por periodicidad ${planForBase?.planPeriodicity ?? 'MENSUAL'}=${nextCharge.toISOString()}`,
      );
    } else if (!nextCharge) {
      this.logger.warn(
        `activatePurchase tenant=${tenant.id}: Hotmart no envió date_next_charge en renovación — preservamos currentPeriodEnd=${tenant.currentPeriodEnd?.toISOString()}`,
      );
    }
    // lastChargeAt — timestamp del pago aprobado real (no calculado).
    const approvedDate = payload.data?.purchase?.approved_date;
    const lastChargeAt = approvedDate ? new Date(approvedDate) : new Date();
    // 2026-06-15: precio REAL pagado en Hotmart → fuente de verdad para la
    // base de comisiones. Solo lo persistimos si vino un valor > 0 (no
    // pisamos con 0/undefined en eventos que no traen price).
    // Bug #10: validamos el value contra el precio canónico del plan para
    // descartar montos en moneda local (Hotmart no manda currency_code).
    const canonicalUsd = await this.getCanonicalBundlePrice(
      planForBase?.planPeriodicity ?? null,
    );
    const realPriceUsd = this.resolvePaidUsd(
      payload,
      'activatePurchase',
      canonicalUsd,
    );
    await this.prisma.tenant.update({
      where: { id: tenant.id },
      data: {
        status: 'ACTIVE',
        ...(realPriceUsd != null
          ? { subscriptionPriceUsd: realPriceUsd }
          : {}),
        // Solo update si Hotmart mandó la fecha O si es primer pago
        // (fallback) — en renovaciones sin date_next_charge preservamos.
        ...(nextCharge ? { currentPeriodEnd: nextCharge } : {}),
        lastChargeAt,
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
        // Precio: monto Hotmart real (validado USD) si vino, sino el
        // canónico del bundle (mismo que usa getCommissionBase).
        const paidUsd = this.resolvePaidUsd(
          payload,
          'generateCommissionsForPayment',
          canonicalUsd,
        );
        const basePrice = paidUsd ?? canonicalUsd;
        await this.referralsService.generateCommissionsForPayment({
          tenantId: tenant.id,
          paymentAmountUsd: basePrice,
          hotmartTransactionId: transactionId ?? null,
        });
      } else {
        await this.generateReferralCommission({
          tenantId: tenant.id,
          paidAmount: this.resolvePaidUsd(
            payload,
            'generateReferralCommission',
            canonicalUsd,
          ),
          transactionId,
        });
      }
    } catch (e) {
      this.logger.warn(
        `generación de comisión falló: ${(e as Error).message}`,
      );
    }
    // SMS al dueño (best-effort): si la cuenta venía SUSPENDED, "cuenta
    // reactivada"; si no, "pago confirmado" (con info del próximo cobro).
    if (wasSuspended) {
      this.smsTemplates
        .render('account_reactivated', { brandName: tenant.brandName })
        .then((msg) => this.notifyOwner(tenant.id, tenant.brandName, msg))
        .catch(() => null);
    } else {
      const nextChargeInfo = nextCharge
        ? ` Próximo cobro: ${fmtSmsDate(nextCharge)}.`
        : '';
      this.smsTemplates
        .render('payment_confirmed', {
          brandName: tenant.brandName,
          nextChargeInfo,
        })
        .then((msg) => this.notifyOwner(tenant.id, tenant.brandName, msg))
        .catch(() => null);
    }

    // Fan-out post-activación (C2 sprint): alerta al equipo comercial,
    // creación de CrmContact en el pipeline del afiliado atribuido y
    // event audit row. Todos fire-and-forget — si fallan no rompen el
    // webhook (Hotmart reintenta agresivamente y queremos 200 idempotente).
    await this.postPurchaseFanOut({
      tenantId: tenant.id,
      brandName: tenant.brandName,
      // Si Hotmart no mandó date_next_charge, pasamos el currentPeriodEnd
      // preservado (puede ser null en casos edge — el fan-out maneja eso).
      nextCharge: nextCharge ?? tenant.currentPeriodEnd ?? new Date(),
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
        status: true,
        hotmartSubscriberCode: true,
        hotmartTransactionId: true,
        currentPeriodEnd: true,
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
    const buyerAny = args.payload.data?.buyer as any;
    await this.notifyPendingRecovery({
      email,
      name: args.payload.data?.buyer?.name ?? null,
      phone: buyerAny?.checkout_phone ?? buyerAny?.phone ?? null,
    }).catch(() => null);
  }

  /**
   * Recuperación de pago "huérfano": email + WhatsApp/SMS al COMPRADOR
   * con el link a /activar (pre-llenado por email), y SMS al equipo
   * comercial. Marca recoveryNotifiedAt para no re-enviar en reintentos
   * del webhook.
   *
   * Fix 2026-06-11: antes solo se mandaba email + alert interna.
   * Si el correo del comprador caía en spam o no lo leía, quedaba en
   * limbo (caso Carlos Pérez urbancafe501@gmail.com). Ahora también:
   *  - WhatsApp al comprador (fallback SMS si no hay WA en la subcuenta).
   *  - Link `/activar?email=<email>` para que la página pre-llene el form
   *    desde el PendingHotmartPayment (nombre, teléfono, plan, precio).
   */
  private async notifyPendingRecovery(opts: {
    email: string;
    name: string | null;
    phone: string | null;
  }) {
    const appUrl = process.env.APP_URL ?? 'https://soyclubify.com';
    const activateUrl = `${appUrl}/activar?email=${encodeURIComponent(opts.email)}`;
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

    // WhatsApp/SMS al comprador con el link pre-llenado.
    const buyerNotify = await this.alerts
      .sendBuyerActivationLink({
        email: opts.email,
        name: opts.name,
        phone: opts.phone,
        activateUrl,
      })
      .catch((e) => ({ ok: false, channel: 'none' as const, error: e?.message }));

    this.alerts
      .sendTeamAlert(
        `💳 Pago Hotmart recibido SIN cuenta aún.\n` +
          `Email: ${opts.email}\n` +
          `Aviso al comprador: email ✅, ${buyerNotify.ok ? `${buyerNotify.channel} ✅` : `WhatsApp/SMS ❌ (sin tel válido)`}\n` +
          `Link: ${activateUrl}`,
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
    scope,
  }: {
    buyerEmail?: string;
    subscriberCode?: string;
    scope?: TenantScope;
  }) {
    // Filtro de aislamiento por marca. Sin scope → global (legado). Con scope:
    // estricto al whiteLabelId, o id + null (Clubify histórico) si includeNull.
    const brandFilter = scope
      ? scope.includeNull
        ? { OR: [{ whiteLabelId: scope.whiteLabelId }, { whiteLabelId: null }] }
        : { whiteLabelId: scope.whiteLabelId }
      : undefined;
    const tenantRelation = brandFilter ? { tenant: brandFilter } : {};
    if (subscriberCode) {
      const t = await this.prisma.tenant.findFirst({
        where: { hotmartSubscriberCode: subscriberCode, ...(brandFilter ?? {}) },
        select: {
          id: true,
          brandName: true,
          status: true,
          hotmartSubscriberCode: true,
          hotmartTransactionId: true,
          currentPeriodEnd: true,
        },
      });
      if (t) return t;
    }
    if (buyerEmail) {
      let user = await this.prisma.user.findFirst({
        where: { email: buyerEmail, role: 'TENANT_OWNER', tenantId: { not: null }, ...tenantRelation },
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
              ...tenantRelation,
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
            status: true,
            hotmartSubscriberCode: true,
            hotmartTransactionId: true,
            currentPeriodEnd: true,
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
          Number(use.referralCode.commissionPercent ?? COMMISSION_DEFAULTS.ambassadorPct),
        );
        const direct = round2((referralBase * pct) / 100);

        if (use.status === 'SIGNED_UP') {
          await this.prisma.referralUse.update({
            where: { id: use.id },
            data: { status: 'PAYING', convertedAt: new Date() },
          });
        }
        await this.prisma.commission
          .create({
            data: {
              referralUseId: use.id,
              amount: direct,
              status: 'PENDING',
              externalTxId: opts.transactionId ?? null,
              recipientCodeId: use.referralCode.id,
              periodKey: monthKey(),
            },
          })
          .catch((e: any) => {
            if (e?.code === 'P2002') {
              this.logger.warn(
                `generateReferralCommission: skip dup directa (useId=${use.id}, code=${use.referralCode.id}, periodKey=${monthKey()})`,
              );
              return null;
            }
            throw e;
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
          await this.prisma.commission
            .create({
              data: {
                referralUseId: parentUse.id,
                amount: indirect,
                status: 'PENDING',
                externalTxId: opts.transactionId ?? null,
                recipientCodeId: parent.id,
                periodKey: monthKey(),
              },
            })
            .catch((e: any) => {
              if (e?.code === 'P2002') {
                this.logger.warn(
                  `generateReferralCommission: skip dup indirecta (useId=${parentUse.id}, code=${parent.id}, periodKey=${monthKey()})`,
                );
                return null;
              }
              throw e;
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

    const pct = Number(socio.commissionPercent ?? COMMISSION_DEFAULTS.socioPct);
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
    await this.prisma.commission
      .create({
        data: {
          referralUseId: use.id,
          amount,
          status: 'PENDING',
          recipientCodeId: socio.id,
          periodKey: monthKey(),
        },
      })
      .catch((e: any) => {
        if (e?.code === 'P2002') {
          this.logger.warn(
            `generateSocioCommission: skip dup (useId=${use.id}, code=${socio.id}, periodKey=${monthKey()})`,
          );
          return null;
        }
        throw e;
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
    transactionId?: string | null;
  }) {
    // Fix audit 2026-06-07: con 3-way split (influencer + embajador +
    // vendor + opcional SOCIO) hay MÚLTIPLES referralUse rows por
    // tenant. La versión vieja solo agarraba el último (orderBy desc)
    // y dejaba huérfanas a las commissions de las otras chains. Ahora
    // churneamos TODOS los uses del tenant.
    const uses = await this.prisma.referralUse.findMany({
      where: { tenantId: opts.tenantId, status: { not: 'CHURNED' } },
      include: {
        commissions: {
          where: { status: { in: ['PENDING', 'APPROVED'] } },
          orderBy: { createdAt: 'desc' },
        },
      },
    });
    if (!uses.length) return;

    await this.prisma.referralUse.updateMany({
      where: { id: { in: uses.map((u) => u.id) } },
      data: { status: 'CHURNED' },
    });

    if (opts.rejectLastCommission) {
      // Rechazar la última commission PENDING/APPROVED de CADA use
      // (no solo del más reciente). Para 3-way refund: rechaza las 3.
      const lastCommissionIds = uses
        .map((u) => u.commissions[0]?.id)
        .filter((id): id is string => !!id);
      if (lastCommissionIds.length) {
        await this.prisma.commission.updateMany({
          where: { id: { in: lastCommissionIds } },
          data: { status: 'REJECTED' },
        });
      }

      // Fase 7 (clawback contable): si la comisión YA fue PAGADA no se toca el
      // histórico — se crea un asiento NEGATIVO (ADJUSTMENT) ligado a la misma
      // transacción, que se descuenta en el próximo corte del beneficiario.
      // Solo clawback de las comisiones PAID que matchean la tx del refund
      // (precisión + trazabilidad). periodKey `adj-<id>` da idempotencia vía
      // el UNIQUE(referralUseId, recipientCodeId, periodKey): el mismo refund
      // reenviado no duplica el asiento.
      if (opts.transactionId) {
        const paid = await this.prisma.commission.findMany({
          where: {
            referralUse: { tenantId: opts.tenantId },
            hotmartTransactionId: opts.transactionId,
            status: 'PAID',
          },
          select: {
            id: true,
            referralUseId: true,
            recipientCodeId: true,
            vendorCodeId: true,
            amount: true,
            currency: true,
            hotmartTransactionId: true,
            externalTxId: true,
            distributionMode: true,
            baseAmountUsd: true,
            appliedPercent: true,
          },
        });
        for (const c of paid) {
          try {
            await this.prisma.commission.create({
              data: {
                referralUseId: c.referralUseId,
                recipientCodeId: c.recipientCodeId,
                vendorCodeId: c.vendorCodeId,
                amount: c.amount.negated(),
                currency: c.currency,
                status: 'ADJUSTMENT',
                paymentStatus: 'PENDING',
                amountPaid: 0,
                hotmartTransactionId: c.hotmartTransactionId,
                externalTxId: c.externalTxId,
                periodKey: `adj-${c.id}`,
                distributionMode: c.distributionMode,
                baseAmountUsd: c.baseAmountUsd,
                appliedPercent: c.appliedPercent,
                notes: `Clawback por refund/chargeback (tx ${opts.transactionId}). Comisión original PAGADA ${c.id} — no se modifica el histórico; este asiento negativo se descuenta en el próximo corte.`,
              },
            });
          } catch (e: any) {
            // P2002 = ya existe el asiento (refund reenviado) → idempotente.
            if (e?.code !== 'P2002') {
              this.logger.warn(
                `Clawback ADJUSTMENT falló para commission ${c.id}: ${(e as Error).message}`,
              );
            }
          }
        }
      }
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

  /**
   * Cron (cada 15 min): si un PendingHotmartPayment lleva ≥ 1 hora sin
   * que el comprador complete /activar, manda SMS al founder para que
   * lo contacte manualmente (2026-06-12).
   *
   * Idempotente: marca `teamReminderSentAt` para no re-enviar. Solo
   * busca pagos de los últimos 7 días para no spammear con backlog
   * histórico al desplegar.
   *
   * Destinatario: Setting `prereg.followupPhone` si está seteado, sino
   * fallback hardcoded a `+573181666999` (Jhon, founder).
   */
  @Cron(CronExpression.EVERY_30_MINUTES)
  async notifyFounderForStaleHotmartPayments(): Promise<void> {
    try {
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const stale = await this.prisma.pendingHotmartPayment.findMany({
        where: {
          consumedAt: null,
          teamReminderSentAt: null,
          createdAt: { lte: oneHourAgo, gte: sevenDaysAgo },
        },
        orderBy: { createdAt: 'asc' },
        take: 20,
      });
      if (stale.length === 0) return;

      const followupSetting = await this.prisma.setting.findUnique({
        where: { key: 'prereg.followupPhone' },
      });
      const phone =
        (followupSetting?.value?.trim() || '+573181666999');

      const account = await this.resolveFollowupAccount();
      if (!account) {
        this.logger.warn(
          `[stale-pending] sin GrowBusinessAccount — skip (${stale.length} pagos pendientes)`,
        );
        return;
      }

      for (const p of stale) {
        const raw = (p.rawPayload ?? {}) as any;
        const buyerName = raw?.data?.buyer?.name ?? '(sin nombre)';
        const productName = raw?.data?.product?.name ?? '(sin producto)';
        const purchaseValue =
          raw?.data?.purchase?.price?.value ??
          raw?.data?.purchase?.original_offer_price?.value ??
          null;
        // Fix 2026-06-12: la moneda viene en el payload — no asumir USD.
        // Hotmart manda el monto en la moneda del país del comprador
        // (COP para Colombia, BRL para Brasil, etc.). Si no viene
        // currency_code fallback a USD que es el plan default.
        const currency =
          (raw?.data?.purchase?.price?.currency_code ??
            raw?.data?.purchase?.original_offer_price?.currency_code ??
            'USD') as string;
        const ageMinutes = Math.floor(
          (Date.now() - p.createdAt.getTime()) / 60000,
        );
        const ageLabel = formatElapsed(ageMinutes);
        const body =
          `🚨 Cliente pagó hace ${ageLabel} y NO completó /activar.\n\n` +
          `Cliente: ${buyerName}\n` +
          `Email: ${p.email}\n` +
          `Producto: ${productName}\n` +
          (purchaseValue
            ? `Monto: ${currency} ${formatMoneyForSms(purchaseValue, currency)}\n`
            : '') +
          `\nContactar manualmente.\n` +
          `Link directo: https://soyclubify.com/activar?email=${encodeURIComponent(p.email)}`;
        const r = await this.growBusiness
          .sendSmsWithCreds(
            {
              locationId: account.locationId,
              apiKey: account.apiKey,
              switchNumber: account.switchNumber,
            },
            phone,
            body,
          )
          .catch((e) => ({ ok: false as const, message: (e as Error).message }));
        if (r.ok) {
          await this.prisma.pendingHotmartPayment.update({
            where: { id: p.id },
            data: { teamReminderSentAt: new Date() },
          });
          this.logger.log(
            `[stale-pending] SMS enviado para ${p.email} (${ageMinutes}min sin activar)`,
          );
        } else {
          this.logger.warn(
            `[stale-pending] SMS falló para ${p.email}: ${(r as any).message ?? 'unknown'}`,
          );
        }
      }
    } catch (e) {
      this.logger.warn(
        `notifyFounderForStaleHotmartPayments falló: ${(e as Error)?.message ?? e}`,
      );
    }
  }

  /** Resuelve la GrowBusinessAccount para el SMS de followup. Misma
   *  prioridad que PreregAlertsService pero sin import del service para
   *  evitar ciclo (HotmartService ya depende de PreregAlertsService
   *  como `alerts` y agregarle método público re-entrante crea
   *  superficie sin necesidad). */
  private async resolveFollowupAccount(): Promise<{
    locationId: string;
    apiKey: string;
    switchNumber: number | null;
  } | null> {
    const setting = await this.prisma.setting.findUnique({
      where: { key: 'prereg.alertAccountId' },
    });
    if (setting?.value) {
      const acc = await this.prisma.growBusinessAccount.findFirst({
        where: { id: setting.value, deletedAt: null },
        select: { locationId: true, apiKey: true, switchNumber: true },
      });
      if (acc) return acc;
    }
    const general = await this.prisma.growBusinessAccount.findFirst({
      where: { purpose: 'GENERAL', deletedAt: null },
      orderBy: { createdAt: 'asc' },
      select: { locationId: true, apiKey: true, switchNumber: true },
    });
    if (general) return general;
    return this.prisma.growBusinessAccount.findFirst({
      where: { deletedAt: null },
      orderBy: { createdAt: 'asc' },
      select: { locationId: true, apiKey: true, switchNumber: true },
    });
  }
}

/**
 * Convierte minutos transcurridos en una etiqueta legible: "45 min",
 * "2h 15min", "1d 4h". Pensado para mensajes al equipo donde 472min
 * no se lee bien — mejor "7h 52min".
 */
/**
 * Formato de monto monetario para SMS. Monedas sin decimales típicas
 * (COP, CLP, etc.) salen con miles separados por coma; con decimales
 * (USD, EUR, BRL) van con 2 decimales fijos. Devuelve sin símbolo —
 * el caller arma "COP 549.095" / "USD 148.55".
 */
function formatMoneyForSms(value: number, currency: string): string {
  const ZERO_DEC = new Set(['COP', 'CLP', 'PYG', 'JPY', 'KRW', 'VND']);
  const ccy = (currency || 'USD').toUpperCase();
  const hasFractional = Math.abs(value - Math.trunc(value)) > 0.001;
  const useZero = ZERO_DEC.has(ccy) && !hasFractional;
  try {
    return new Intl.NumberFormat('en-US', {
      minimumFractionDigits: useZero ? 0 : 2,
      maximumFractionDigits: useZero ? 0 : 2,
    }).format(value);
  } catch {
    return String(value);
  }
}

function formatElapsed(totalMinutes: number): string {
  const m = Math.max(0, Math.floor(totalMinutes));
  if (m < 60) return `${m} min`;
  const hours = Math.floor(m / 60);
  const mins = m % 60;
  if (hours < 24) return mins > 0 ? `${hours}h ${mins}min` : `${hours}h`;
  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;
  return remainingHours > 0 ? `${days}d ${remainingHours}h` : `${days}d`;
}
