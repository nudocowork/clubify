import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../common/prisma/prisma.service';
import { GrowBusinessService } from '../integrations/grow-business.service';
import { EmailService } from '../email/email.service';
import { BillingService } from './billing.service';
import { PendingActivationService } from './pending-activation.service';
import { ReferralsService } from '../referrals/referrals.service';
import { PreregAlertsService } from '../auth/prereg-alerts.service';
import { CommissionExceptionsService } from '../admin/commission-exceptions.service';
import { monthKey } from '../common/period-key';
import { COMMISSION_DEFAULTS } from '../common/commission-defaults';
import { addPlanPeriod, parsePlanPeriodLabel } from '../common/plan-period';
import { getCanonicalBundlePrice } from '../common/plan-pricing';
import { SmsTemplatesService } from './sms-templates.service';
import { BrandEmailService } from '../email/brand-email.service';
import { fmtEmailDate } from '../email/brand-email-templates';
import { isBrandTemplateSendEnabled } from '../integrations/brand-message-templates';
import { parseWlIdFromSrc, parseAffiliateRawFromSrc } from './hotmart-src';
import { ModuleRef } from '@nestjs/core';
import { MembershipBillingService } from '../cuponera/membership-billing.service';
import { WhiteLabelNotificationsService } from '../white-label-notifications/white-label-notifications.service';
import { BusinessGroupsService } from '../business-groups/business-groups.service';
import { OnboardingWebhookService } from '../onboarding-sync/onboarding-webhook.service';
import { fmtSmsDate } from './sms-templates';
import { IncomeRecordService } from '../finance/income-record.service';
import { decryptSecret } from '../common/crypto/secret-box';

const round2 = (n: number) => Math.round(n * 100) / 100;

// availableAt (hold) = cobro + 15d, SIEMPRE anclado a la fecha real del cobro
// (lastChargeAt). FIX 2026-08-31: se quitó el clamp que re-anclaba a HOY los
// cobros >2d viejos — hacía que una renovación creada tarde desbloqueara ~40-50
// días tarde y cayera en el corte equivocado (Motilart/Quipao). El clamp
// protegía una heurística de FECHA hoy obsoleta (businessDate ya es durable).
// Espejo del helper de referrals.service.
function holdReleaseFrom(charge: Date | null | undefined): Date {
  const c = charge ? new Date(charge).getTime() : Date.now();
  return new Date(c + 15 * 86400000);
}

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
    buyer?: {
      email?: string;
      name?: string;
      /** V2 manda el teléfono del checkout partido en dos campos. Se usa
       *  para dar de alta beneficiarios de cuponera (§24), que se buscan
       *  por teléfono; si no viene, se cae al email. */
      checkout_phone?: string;
      phone?: string;
      phone_number?: string;
      phone_local_code?: string;
    };
    subscription?: {
      subscriber?: { code?: string };
      /** Plan REAL contratado, ej. "Plan Trimestral 150 USD". Es la fuente
       *  autoritativa de la periodicidad — ver parsePlanPeriodLabel. */
      plan?: { id?: number; name?: string };
      date_next_charge?: number;
      status?: string;
    };
    purchase?: {
      transaction?: string;
      status?: string;
      approved_date?: number;
      // OJO (2026-08-18): en los payloads REALES de compra Hotmart manda
      // `date_next_charge` ACÁ, dentro de purchase — NO en subscription (donde
      // en PURCHASE_APPROVED solo llegan plan/status/subscriber). Leerlo solo
      // de subscription hacía que la fecha oficial de Hotmart se descartara en
      // todas las altas y cayéramos siempre al fallback local. El evento
      // UPDATE_SUBSCRIPTION_CHARGE_DATE sí la manda en subscription, así que
      // hay que mirar ambas: usar nextChargeFromPayload().
      date_next_charge?: number;
      // Hotmart manda el monto pagado en USD aquí. Lo usamos para calcular
      // la comisión del referido. Si no viene, caemos a plan.priceMonthly.
      // OJO: Hotmart manda la moneda como `currency_value` (ej. "PAB", "COP",
      // "USD"), y a veces `currency_code`. Revisamos ambos.
      price?: { value?: number; currency_code?: string; currency_value?: string };
      // Oferta específica del checkout. Varias ofertas pueden compartir el mismo
      // productId (ej. packs de 1/10/20 créditos) → el offer.code distingue cuál.
      offer?: { code?: string; description?: string };
      // Tracking del checkout: Hotmart devuelve aquí el `src`/`sck` que se pasó
      // en la URL de compra (viene ausente si el checkout no llevó ninguno).
      // Modelo B de créditos: metemos `src=wl_<whiteLabelId>` para identificar la
      // marca compradora sin depender del correo. Confirmado contra payloads
      // reales: la ubicación es data.purchase.tracking.
      tracking?: {
        source?: string;
        source_sck?: string;
        sck?: string;
        external_code?: string;
      };
    };
    product?: { id?: number; name?: string };
  };
};

/**
 * Fecha del próximo cobro según Hotmart, mirando las DOS rutas del payload.
 *
 * FIX 2026-08-18: los payloads de compra la traen en `data.purchase`; el código
 * solo leía `data.subscription`, que en PURCHASE_APPROVED ni siquiera existe
 * (subscription trae plan/status/subscriber y nada más). Resultado: la fecha
 * oficial se descartaba en todas las altas. El evento
 * UPDATE_SUBSCRIPTION_CHARGE_DATE sí la manda en subscription, así que hay que
 * soportar ambas rutas.
 */
function nextChargeFromPayload(payload: HotmartWebhookPayload): Date | null {
  const raw =
    payload.data?.purchase?.date_next_charge ??
    payload.data?.subscription?.date_next_charge;
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Teléfono del comprador en un payload de Hotmart. V2 lo manda partido
 * (phone_local_code = indicativo, phone_number = resto) y a veces entero en
 * checkout_phone. Solo lo usa la cuponera (§24), donde el beneficiario se
 * identifica por teléfono; para los negocios la clave es el email.
 * Devuelve '' si no vino: enrollMember cae al email en ese caso.
 */
function hotmartBuyerPhone(payload: HotmartWebhookPayload): string {
  const b = payload.data?.buyer;
  if (!b) return '';
  const entero = (b.checkout_phone || b.phone || '').trim();
  if (entero) return entero;
  const code = (b.phone_local_code || '').trim();
  const num = (b.phone_number || '').trim();
  if (!num) return '';
  return code ? `+${code.replace(/^\+/, '')}${num}` : num;
}

@Injectable()
export class HotmartService {
  private logger = new Logger(HotmartService.name);

  /**
   * MembershipBillingService se resuelve TARDE y por el contenedor, no por
   * inyección: importar CuponeraModule desde acá cierra el ciclo
   * Billing → Cuponera → Locations → Tenants → Billing. Con ModuleRef no hay
   * arista en el grafo de módulos.
   *
   * Si el módulo de cuponera no está montado (un deploy sin él), devuelve null y
   * el webhook sigue su curso normal en vez de romperse — que es justo lo que
   * queremos del camino de dinero de la plataforma.
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

  /**
   * Un grupo empresarial paga UNA suscripción de Hotmart por varios negocios.
   * El código de suscriptor vive en uno solo, así que el webhook movía su
   * fecha y dejaba a los hermanos con la del ciclo anterior: se quedaban a un
   * día de que el cron los marcara en mora estando al día.
   *
   * Pasó tres veces seguidas con el grupo Aldehir (Mistíka) y hubo que
   * corregirlo a mano cada vez.
   *
   * Propaga la fecha del ciclo a los hermanos ACTIVOS y limpia sus SEIS
   * campos de deduplicación — sin eso no reciben ningún aviso del ciclo
   * nuevo. Ver [[clubify-cobros-trampas]].
   *
   * No toca `hotmartSubscriberCode` de nadie: el código pertenece a quien
   * paga, y duplicarlo haría que el próximo webhook casara con varios.
   */
  private async propagarCicloAlGrupo(tenantId: string, hasta: Date) {
    const yo = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { businessGroupId: true },
    });
    if (!yo?.businessGroupId) return;

    const r = await this.prisma.tenant.updateMany({
      where: {
        businessGroupId: yo.businessGroupId,
        id: { not: tenantId },
        // Un negocio dado de baja del grupo no revive por un cobro ajeno.
        status: { in: ['ACTIVE', 'TRIAL'] },
      },
      data: {
        currentPeriodEnd: hasta,
        status: 'ACTIVE',
        trialEndsAt: null,
        failedPaymentCount: 0,
        suspendedAt: null,
        paymentReminderSentFor: null,
        paymentFailureNoticeSentAt: null,
        pausePendingNoticeSentAt: null,
        preReminder7dSentFor: null,
        preReminder3dSentFor: null,
        preReminderTodaySentFor: null,
      },
    });
    if (r.count) {
      this.logger.log(
        `Ciclo propagado al grupo ${yo.businessGroupId}: ${r.count} negocio(s) hasta ${hasta.toISOString().slice(0, 10)}`,
      );
    }
  }

  constructor(
    private prisma: PrismaService,
    private moduleRef: ModuleRef,
    private growBusiness: GrowBusinessService,
    // Solo para los avisos de cadena de referidos (notifyReferralChain); el
    // correo al COMPRADOR sale por PendingActivationService → BrandEmailService.
    private email: EmailService,
    private pendingActivation: PendingActivationService,
    private billing: BillingService,
    private referralsService: ReferralsService,
    private alerts: PreregAlertsService,
    private commissionExceptions: CommissionExceptionsService,
    private smsTemplates: SmsTemplatesService,
    private brandEmail: BrandEmailService,
    private wlNotifications: WhiteLabelNotificationsService,
    private businessGroups: BusinessGroupsService,
    private onboardingWebhook: OnboardingWebhookService,
    // CONTABILIDAD Fase 1: histórico de ingreso real por cobro. Best-effort.
    private incomeRecord: IncomeRecordService,
  ) {}

  /** Precio canónico del bundle en USD (68/150/278/500) según periodicidad,
   *  con override por Setting `landing.plans.<period>.price`. Delegado a
   *  common/plan-pricing (misma verdad que el importe sugerido de los pagos
   *  manuales). Se pasa prisma directo — sin acoplar servicios (evita ciclos
   *  de DI, igual que la réplica que había antes). */
  private async getCanonicalBundlePrice(
    periodicity: string | null,
  ): Promise<number> {
    return getCanonicalBundlePrice(this.prisma, periodicity);
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

    // FIX 2026-07-07 (ALTIERI): Hotmart manda la moneda como `currency_value`
    // (no `currency_code`). ALTIERI pagó 291.15 PAB → sin este check se tomaba
    // como USD e inflaba la comisión ($29.12 vs $27.80). La regla del negocio:
    // SIEMPRE el precio pactado (canónico) sin importar en qué moneda pagó.
    const ccy = (
      price?.currency_code ||
      price?.currency_value ||
      ''
    ).toUpperCase();
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

  /**
   * Stage 4 (PDF734): envía (best-effort) una plantilla administrativa (admin_*)
   * al dueño SOLO si la marca la activó en el panel de Automatizaciones. OFF por
   * defecto. Aislada por marca — notifyOwner usa las creds propias/subcuenta de
   * la marca, nunca las de Clubify. Devuelve true si se envió.
   */
  private async maybeSendAdminNotice(
    tenant: { id: string; brandName: string },
    templateId: string,
  ): Promise<boolean> {
    try {
      const row = await this.prisma.tenant.findUnique({
        where: { id: tenant.id },
        select: { whiteLabelId: true },
      });
      const enabled = await isBrandTemplateSendEnabled(
        this.prisma,
        templateId,
        row?.whiteLabelId ?? null,
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

    // Cuponera (spec §24-25): si el producto está mapeado a un plan de membresía,
    // la compra NO es de un negocio ni de un pack de créditos — es una persona
    // comprando su Living Card. Va ACÁ, antes de findTenant, por la misma razón
    // que los créditos: el comprador no tiene tenant, y sin este corte caería en
    // storePendingPayment y le mandaríamos un correo diciéndole que cree un
    // negocio, que es justo lo que NO compró.
    const cuponeraAction = await this.tryHandleCuponeraMembership(payload).catch((e) => {
      this.logger.error(`tryHandleCuponeraMembership falló: ${(e as Error)?.message}`);
      return null;
    });
    if (cuponeraAction) {
      return { ok: true, action: cuponeraAction };
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
    const groupAction = await this.businessGroups
      .tryHandleHotmartEvent({
        event,
        subscriberCode,
        buyerEmail,
        nextChargeDate: nextChargeFromPayload(payload),
      })
      .catch((e) => {
        this.logger.error(`group hotmart handler falló: ${(e as Error)?.message}`);
        return null;
      });
    if (groupAction) {
      this.logger.log(`Hotmart event ${event} → grupo: ${groupAction}`);
      // Punto 2 (2026-07-01): al activarse el cobro del grupo, generamos SU
      // comisión (1 por el bruto del grupo) al recipiente elegido. Best-effort.
      if (groupAction.startsWith('group_activated:')) {
        const groupId = groupAction.slice('group_activated:'.length);
        await this.referralsService
          .generateGroupCommission({
            groupId,
            hotmartTransactionId: transactionId ?? subscriberCode ?? null,
          })
          .catch((e) =>
            this.logger.error(`group commission falló: ${(e as Error)?.message}`),
          );
      }
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
          // Marca del webhook (ruta /:slug). La tabla no la guarda, pero el
          // aviso al comprador sí debe salir con la identidad correcta.
          whiteLabelId: scope?.whiteLabelId ?? null,
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
  /** Extrae el whiteLabelId de un token de tracking del checkout Hotmart.
   *  Formato esperado: "wl_<uuid>" (lo que inyecta el Master Admin en ?src=).
   *  Acepta separador _ o -, y tolera un uuid pelado. null si no parece token. */
  private parseWlToken(raw: string | null | undefined): string | null {
    // Delega en el helper puro (testeado). Encuentra `wl_<uuid>` aunque venga
    // combinado con el código de afiliado (src=`<CODE>-wl_<uuid>`).
    return parseWlIdFromSrc(raw);
  }

  /**
   * PDF Soft(9): atribución ROBUSTA server-side de un negocio a su afiliado.
   * Si el tenant NO tiene un ReferralUse de afiliado (INFLUENCER/AMBASSADOR/
   * VENDOR), intenta recuperarlo del `src` que el checkout del afiliado envía a
   * Hotmart (`?src=<CODE>`). Cubre los casos donde el ref se perdió en el cliente
   * (otro dispositivo / incógnito / localStorage borrado) o donde el código
   * estaba INACTIVO y el signup lo descartó silenciosamente (quedaba "landing").
   * Registra la atribución AUNQUE el código esté inactivo (no la perdemos); la
   * decisión de pagar/anular la comisión sigue el flujo/moderación normal.
   * Idempotente: no hace nada si ya hay atribución (findFirst antes de crear;
   * no hay unique compuesto en ReferralUse).
   */
  private async ensureAffiliateAttributionFromSrc(
    tenantId: string,
    payload: HotmartWebhookPayload,
  ): Promise<void> {
    const existing = await this.prisma.referralUse.findFirst({
      where: {
        tenantId,
        referralCode: { role: { in: ['INFLUENCER', 'AMBASSADOR', 'VENDOR'] } },
      },
      select: { id: true },
    });
    if (existing) return; // ya atribuido — no tocar

    const tracking = payload.data?.purchase?.tracking;
    const rawSrc = (
      tracking?.source ||
      tracking?.source_sck ||
      tracking?.sck ||
      tracking?.external_code ||
      ''
    ).trim();
    // FIX 2026-08-18: el `src` puede traer AFILIADO Y MARCA combinados
    // (`<CODE>-wl_<uuid>`). Extraemos SOLO la parte de afiliado (quitando el
    // token de marca). Antes cortábamos ante cualquier `wl_` → las compras de
    // marca blanca por link de afiliado quedaban SIN atribuir (bug Taquería).
    // Si el src era solo marca (wl_<uuid>) → affRaw null → no hay afiliado.
    const affRaw = parseAffiliateRawFromSrc(rawSrc);
    if (!affRaw) return;

    // El src del afiliado es su CODE (ej "CB2026"). Fallback: resolver por slug.
    const code = affRaw.toUpperCase();
    let ref = /^[A-Z0-9]{4,20}$/.test(code)
      ? await this.prisma.referralCode.findUnique({
          where: { code },
          select: { id: true, isActive: true, ownerName: true, role: true },
        })
      : null;
    if (!ref) {
      ref = await this.prisma.referralCode.findFirst({
        where: { slug: affRaw.toLowerCase() },
        select: { id: true, isActive: true, ownerName: true, role: true },
      });
    }
    if (!ref) return; // src no matchea ningún afiliado → queda sin atribuir

    try {
      await this.prisma.referralUse.create({
        data: {
          referralCodeId: ref.id,
          tenantId,
          status: 'PAYING',
          utmSource: 'hotmart-src',
        },
      });
      this.logger.log(
        `[ATTR] atribución server-side desde src="${rawSrc}" → ${ref.ownerName} ` +
          `(${ref.role})${ref.isActive ? '' : ' [código INACTIVO]'} · tenant ${tenantId}`,
      );
    } catch (e) {
      this.logger.warn(
        `[ATTR] no se pudo crear ReferralUse desde src: ${(e as Error).message}`,
      );
    }
  }

  async tryHandleCreditPurchase(
    payload: HotmartWebhookPayload,
    dryRun = false,
  ): Promise<string | null> {
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

    // ── Identificación de la MARCA (Modelo B — token en el checkout) ──
    // Precedencia:
    //   1) token del checkout: src=wl_<whiteLabelId> (o sck/external_code) →
    //      marca EXACTA, sin importar con qué correo se pagó. Es lo robusto
    //      cuando las 3 ofertas (1/10/20) son COMPARTIDAS entre marcas.
    //   2) relación directa del link (ofertas PROPIAS de una marca, Modelo A).
    //   3) correo del comprador = adminEmail de una marca (último recurso).
    //   4) sin match → UNASSIGNED (NUNCA acreditar a la marca equivocada).
    const tracking = payload.data?.purchase?.tracking;
    const rawToken = (
      tracking?.source ||
      tracking?.source_sck ||
      tracking?.sck ||
      tracking?.external_code ||
      ''
    ).trim();
    let whiteLabelId: string | null = null;
    let resolvedBy: 'token' | 'link' | 'email' | 'none' = 'none';

    const tokenWlId = this.parseWlToken(rawToken);
    if (tokenWlId) {
      const wl = await this.prisma.whiteLabel.findUnique({
        where: { id: tokenWlId },
        select: { id: true },
      });
      if (wl) {
        whiteLabelId = wl.id;
        resolvedBy = 'token';
      } else {
        this.logger.warn(
          `[CREDITOS] token src="${rawToken}" no matchea ninguna marca — sigo con fallbacks`,
        );
      }
    }
    if (!whiteLabelId && creditLink.whiteLabelId) {
      whiteLabelId = creditLink.whiteLabelId;
      resolvedBy = 'link';
    }
    if (!whiteLabelId && buyerEmail) {
      const byEmail = await this.prisma.whiteLabel.findFirst({
        where: { adminEmail: { equals: buyerEmail, mode: 'insensitive' } },
        select: { id: true },
      });
      if (byEmail) {
        whiteLabelId = byEmail.id;
        resolvedBy = 'email';
      }
    }

    // Carga la marca resuelta + su flag ilimitado (descarta ids colgados).
    let creditsUnlimited = false;
    if (whiteLabelId) {
      const wl = await this.prisma.whiteLabel.findUnique({
        where: { id: whiteLabelId },
        select: { id: true, creditsUnlimited: true },
      });
      if (!wl) {
        whiteLabelId = null; // marca borrada → UNASSIGNED
        resolvedBy = 'none';
      } else {
        creditsUnlimited = wl.creditsUnlimited;
      }
    }

    // GUARD Modelo B: si la compra cayó a una marca ILIMITADA (típicamente
    // Clubify, dueña de las ofertas COMPARTIDAS) y NO fue por token, es casi
    // seguro una compra de OTRA marca que olvidó el token → UNASSIGNED, para no
    // absorberla en silencio. Una marca ilimitada nunca necesita comprar.
    if (whiteLabelId && creditsUnlimited && resolvedBy !== 'token') {
      this.logger.warn(
        `[CREDITOS] compra sin token cayó a marca ILIMITADA por '${resolvedBy}' → UNASSIGNED ` +
          `(evita absorber la compra de otra marca)`,
      );
      whiteLabelId = null;
      resolvedBy = 'none';
    }

    this.logger.log(
      `[CREDITOS] MARCA IDENTIFICADA por=${resolvedBy} · ` +
        `whiteLabelId=${whiteLabelId ?? 'NINGUNA (→ UNASSIGNED)'} unlimited=${creditsUnlimited} ` +
        `token='${rawToken || '-'}' buyer(informativo)=${buyerEmail ?? '-'}`,
    );

    // Modo simulación (dryRun): resolvimos marca + cantidad SIN escribir nada.
    // Sirve para verificar el ruteo por token desde el simulador sin tocar los
    // créditos reales ni la idempotencia.
    if (dryRun) {
      return (
        `DRYRUN · resolvedBy=${resolvedBy} · whiteLabelId=${whiteLabelId ?? 'UNASSIGNED'} · ` +
        `credits=${creditLink.credits} · unlimited=${creditsUnlimited} · token='${rawToken || '-'}'`
      );
    }

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
        `[CREDITOS] ERROR: tx=${transactionId} sin marca — el link (product=${productId} ` +
          `offer=${offerCode ?? '-'}) no tiene whiteLabelId y no existe la marca Clubify. ` +
          `→ UNASSIGNED. Asigná la marca al link o la compra desde /superadmin/creditos.`,
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
          note: `Compra Hotmart · ${creditLink.label} · tx=${transactionId} · marca por=${resolvedBy}`,
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
  /**
   * Compra/baja de una membresía de cuponera por Hotmart (spec §24-25).
   * Devuelve null si el producto NO está mapeado a ningún plan — o sea, si esto
   * es una compra normal de la plataforma y tiene que seguir su curso.
   */
  private async tryHandleCuponeraMembership(
    payload: HotmartWebhookPayload,
  ): Promise<string | null> {
    const svc = this.cuponeraBilling();
    if (!svc) return null;

    const event = payload.event;
    if (!event) return null;

    const productId = payload.data?.product?.id;
    const offerCode = payload.data?.purchase?.offer?.code;
    const buyerEmail = payload.data?.buyer?.email?.toLowerCase() ?? null;
    const subscriberCode = payload.data?.subscription?.subscriber?.code ?? null;
    const transaction = payload.data?.purchase?.transaction ?? null;

    const ALTA = event === 'PURCHASE_APPROVED' || event === 'PURCHASE_COMPLETE';
    const BAJA =
      event === 'PURCHASE_REFUNDED' ||
      event === 'PURCHASE_CHARGEBACK' ||
      event === 'SUBSCRIPTION_CANCELLATION';
    const FALLIDO = event === 'PURCHASE_DELAYED' || event === 'PURCHASE_PROTEST';
    if (!ALTA && !BAJA && !FALLIDO) return null;

    // En baja/fallido el payload no siempre trae producto; se resuelve por la
    // referencia de suscripción. Si no hay membresía con esa referencia, esto no
    // era una cuponera y devolvemos null para no comernos el evento.
    if (!ALTA) {
      const ref = subscriberCode ?? transaction;
      const membership = ref
        ? await this.prisma.livingMembership.findFirst({
            where: { provider: 'HOTMART', OR: [{ providerRef: ref }] },
            select: { id: true },
          })
        : null;
      if (!membership) return null;
      return FALLIDO
        ? svc.paymentFailed({
            provider: 'HOTMART',
            ref,
            email: buyerEmail,
            reason: event,
          })
        : svc.deactivate({
            provider: 'HOTMART',
            ref,
            email: buyerEmail,
            reason: event,
          });
    }

    const match = await svc.matchHotmartPlan(
      productId === undefined || productId === null ? null : String(productId),
      offerCode,
    );
    if (!match) return null;
    if (match === 'ambiguous') return 'cuponera_membership_offer_ambiguous';

    if (!buyerEmail) {
      this.logger.error(
        `[CUPONERA-PAGOS] compra Hotmart sin email de comprador (tx=${transaction ?? '-'}). ` +
          `No hay a quién dar de alta.`,
      );
      return 'cuponera_membership_no_email';
    }

    // Una renovación reusa el mismo subscriberCode: si ya hay membresía con esa
    // referencia, se corre el vencimiento en vez de dar de alta de nuevo.
    if (subscriberCode) {
      const yaEs = await this.prisma.livingMembership.findFirst({
        where: { providerRef: subscriberCode },
        select: { id: true },
      });
      if (yaEs) {
        return svc.renew({
          provider: 'HOTMART',
          ref: subscriberCode,
          email: buyerEmail,
          until: nextChargeFromPayload(payload),
          transactionRef: transaction,
          amountCents: null,
          currency: match.plan.currency,
        });
      }
    }

    return svc.activate({
      match,
      provider: 'HOTMART',
      transactionRef: transaction ?? `hotmart:${subscriberCode ?? buyerEmail}`,
      subscriptionRef: subscriberCode,
      email: buyerEmail,
      fullName: payload.data?.buyer?.name ?? null,
      phone: hotmartBuyerPhone(payload),
      expiresAt: nextChargeFromPayload(payload),
      raw: { event, transaction, subscriberCode },
    });
  }

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
        const wasFirstFailure = !tenant.firstFailedAt;
        await this.prisma.tenant.update({
          where: { id: tenant.id },
          data: {
            failedPaymentCount: { increment: 1 },
            lastPaymentAttemptAt: now,
            // Ancla INMUTABLE de la gracia: se fija solo en el 1er fallo. Antes
            // el reloj de gracia se anclaba en lastPaymentAttemptAt, que esta
            // misma línea pisa a `now` en CADA reintento de Hotmart → la mora
            // volvía a 0 días y nunca llegaba al día 6 (causa raíz de que no
            // suspendiera). Con `?? now` solo se estampa la primera vez.
            firstFailedAt: tenant.firstFailedAt ?? now,
            paymentFailureNoticeSentAt: now,
          },
        });
        await this.billing
          .auditLifecycle('subscription.payment_failed', tenant.id, { gateway: 'HOTMART', event })
          .catch(() => null);
        // Fase 3: alerta interna al equipo SOLO en el 1er fallo (no en cada
        // reintento de Hotmart) para no spamear.
        if (wasFirstFailure) {
          await this.billing
            .notifyBillingTeam('renovacion_fallida', tenant.brandName)
            .catch(() => null);
        }
        // SMS aviso de falla (best-effort). Si es PROTEST y la marca activó
        // "Pago en disputa" (admin_protest), se envía ese texto en su lugar.
        const sentProtest =
          event === 'PURCHASE_PROTEST'
            ? await this.maybeSendAdminNotice(tenant, 'admin_protest')
            : false;
        if (!sentProtest) {
          this.smsTemplates
            .render('payment_failed', { brandName: tenant.brandName }, tenant.id)
            .then((msg) => this.notifyOwner(tenant.id, tenant.brandName, msg))
            .catch(() => null);
        }
        // Correo del evento. Una disputa NO es un cobro fallido: el dinero se
        // cobró y el banco lo está discutiendo, así que va su propio texto.
        this.brandEmail
          .sendTemplate({
            templateId:
              event === 'PURCHASE_PROTEST'
                ? 'email_dispute'
                : 'email_payment_failed',
            tenantId: tenant.id,
          })
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
        // PDF 1256 §2/§8: liberar crédito a la marca (marca blanca) + auditar.
        await this.billing
          .releaseBrandCreditOnSuspend(tenant.id, `hotmart_${event.toLowerCase()}`)
          .catch(() => null);
        await this.billing
          .auditLifecycle('subscription.suspended', tenant.id, { gateway: 'HOTMART', reason: event })
          .catch(() => null);
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
        // Stage 4: aviso admin al dueño si la marca lo activó (OFF por defecto).
        const adminNoticeId =
          event === 'PURCHASE_REFUNDED'
            ? 'admin_refunded'
            : event === 'PURCHASE_CHARGEBACK'
              ? 'admin_chargeback'
              : 'admin_cancellation';
        this.maybeSendAdminNotice(tenant, adminNoticeId).catch(() => null);
        // Correo del cierre del ciclo. A diferencia del SMS admin_*, va ON por
        // defecto: su gate es que la marca tenga con qué enviar.
        this.brandEmail
          .sendTemplate({
            templateId:
              event === 'PURCHASE_REFUNDED'
                ? 'email_refunded'
                : event === 'PURCHASE_CHARGEBACK'
                  ? 'email_chargeback'
                  : 'email_cancellation',
            tenantId: tenant.id,
          })
          .catch(() => null);
        return { ok: true, action: 'suspended' };
      }

      case 'UPDATE_SUBSCRIPTION_CHARGE_DATE': {
        const next = nextChargeFromPayload(payload);
        if (next) {
          await this.prisma.tenant.update({
            where: { id: tenant.id },
            data: { currentPeriodEnd: next },
          });
        }
        // Stage 4: aviso "Mover próximo cobro" si la marca lo activó.
        this.maybeSendAdminNotice(tenant, 'admin_charge_date_moved').catch(
          () => null,
        );
        // Solo si de verdad hay fecha nueva. Sin ella el correo diría "tu
        // nueva fecha es el <la vieja>" — o dejaría el hueco a la vista.
        if (next) {
          this.brandEmail
            .sendTemplate({
              templateId: 'email_charge_date_moved',
              tenantId: tenant.id,
              vars: { nextChargeDate: fmtEmailDate(next) },
            })
            .catch(() => null);
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
    // La alerta "🎉 Nueva compra Clubify" (equipo de onboarding) va SOLO en la
    // PRIMERA compra Hotmart del tenant. Señal robusta: no tenía transacción
    // Hotmart previa (hotmartTransactionId null). Un re-envío/reintento de
    // Hotmart o una renovación ya traen el tx seteado → se omite.
    //
    // FIX 2026-07-06: antes usábamos status==='ACTIVE' como "renovación", pero
    // los negocios que se crean ACTIVE (activación por créditos) ANTES de su
    // primer cobro quedaban marcados como renovación y la alerta de la venta
    // nueva NO se enviaba. hotmartTransactionId sí distingue bien.
    const isFirstHotmartPurchase = !tenant.hotmartTransactionId;
    const subscriberCode = payload.data?.subscription?.subscriber?.code;
    const transactionId = payload.data?.purchase?.transaction;
    // FIX PDF123 (cobro duplicado): Hotmart dispara PURCHASE_APPROVED y — días
    // después, al cerrar la ventana de garantía — PURCHASE_COMPLETE para la MISMA
    // transacción. Ambos entran acá con eventIds distintos (pasan el claimEvent) y
    // mandaban "Pago recibido" DOS veces. Si esta transacción ya es la que el
    // tenant tiene guardada, es un re-aviso del mismo pago: reactivamos igual
    // (idempotente) pero NO reenviamos el SMS. Una renovación real trae otro
    // transaction → sí notifica.
    const alreadyConfirmedTx =
      !!transactionId && transactionId === tenant.hotmartTransactionId;
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
      select: { planPeriodicity: true, purchasedAt: true },
    });
    // FIX 2026-08-18 (caso El Arrayán express): la periodicidad la escribía SOLO
    // el form de /activar (dto.planPeriodicity). Si el comprador no entraba por
    // el link de recuperación con ?email=, quedaba null y TODO el sistema lo
    // leía como MENSUAL: próximo cobro a +1 mes sobre un plan trimestral (y la
    // suspensión automática 3 días después de esa fecha falsa, con el cliente
    // al día), comisión sobre el canónico mensual, y MRR sub-contado.
    // Hotmart manda el plan REAL en subscription.plan.name ("Plan Trimestral
    // 150 USD") → fuente autoritativa. Solo lo escribimos cuando falta: un
    // valor ya cargado (o corregido a mano por un admin) NO se pisa.
    let effectivePeriod = planForBase?.planPeriodicity ?? null;
    const periodFromHotmart = effectivePeriod
      ? null
      : parsePlanPeriodLabel(payload.data?.subscription?.plan?.name);
    if (periodFromHotmart) {
      effectivePeriod = periodFromHotmart;
      this.logger.log(
        `activatePurchase tenant=${tenant.id}: planPeriodicity ausente — derivada de Hotmart ("${payload.data?.subscription?.plan?.name}") = ${periodFromHotmart}`,
      );
    }
    let nextCharge = nextChargeFromPayload(payload);
    if (!nextCharge && !tenant.currentPeriodEnd) {
      // Bug #1: el fallback debe respetar la periodicidad real del plan
      // (Trimestral = +3 meses, no +30 días fijos). Antes siempre sumaba 30d.
      nextCharge = addPlanPeriod(new Date(), effectivePeriod);
      this.logger.warn(
        `activatePurchase tenant=${tenant.id}: primer pago sin date_next_charge — fallback por periodicidad ${effectivePeriod ?? 'MENSUAL'}=${nextCharge.toISOString()}`,
      );
    } else if (!nextCharge) {
      this.logger.warn(
        `activatePurchase tenant=${tenant.id}: Hotmart no envió date_next_charge en renovación — preservamos currentPeriodEnd=${tenant.currentPeriodEnd?.toISOString()}`,
      );
    }
    // lastChargeAt — timestamp del pago aprobado real (no calculado).
    const approvedDate = payload.data?.purchase?.approved_date;
    const lastChargeAt = approvedDate ? new Date(approvedDate) : new Date();
    // Ancla canónica para validar el monto. Usa `effectivePeriod`, NO
    // planForBase.planPeriodicity: cuando la DB tiene la periodicidad en null
    // (caso El Arrayán) esa variable ya trae la derivada de Hotmart. Con null,
    // getCanonicalBundlePrice cae a MENSUAL=$68 y resolvePaidUsd valida en banda
    // [0.3x,1.6x]=[20,109]: un trimestral real de $150 quedaría FUERA de banda,
    // se descartaría como moneda local y el pago se registraría como $68.
    const canonicalUsd = await this.getCanonicalBundlePrice(effectivePeriod);
    // El monto REAL pagado (USD), validado contra el canónico para descartar
    // moneda local (Hotmart no manda currency_code). Va a AUDITORÍA
    // (lastPaymentAmountUsd), NUNCA a la base de comisiones: la comisión se
    // calcula sobre el precio PACTADO canónico. Solo se persiste si vino > 0
    // (no pisamos con 0/undefined en eventos que no traen price).
    const realPriceUsd = this.resolvePaidUsd(
      payload,
      'activatePurchase',
      canonicalUsd,
    );
    // CONTABILIDAD (Fase 1): registrar el ingreso real de Hotmart con su
    // desglose (bruto/fee/impuesto/neto, histórico). Solo si vino el monto
    // real (>0); el servicio deduplica por transactionId. Best-effort, aditivo.
    void this.incomeRecord.record({
      gateway: 'HOTMART',
      externalTxId: transactionId ?? tenant.hotmartTransactionId,
      tenantId: tenant.id,
      whiteLabelId: (tenant as { whiteLabelId?: string | null }).whiteLabelId ?? null,
      brandName: tenant.brandName,
      planPeriodicity: periodFromHotmart ?? null,
      currency: 'USD',
      grossUsd: realPriceUsd,
      isFirstPayment: !tenant.currentPeriodEnd,
      saleDate: lastChargeAt ?? new Date(),
    });
    await this.prisma.tenant.update({
      where: { id: tenant.id },
      data: {
        status: 'ACTIVE',
        // Periodicidad derivada del plan de Hotmart cuando el alta la dejó en
        // null (ver comentario arriba). Va en el mismo update que el resto para
        // que la fecha de cobro y el canónico de la comisión queden coherentes
        // de una. Como el canónico del plan ES la base de comisión cuando no
        // hay override manual, sin esto un trimestral cobraba sobre $68.
        ...(periodFromHotmart ? { planPeriodicity: periodFromHotmart } : {}),
        // 2026-07-31: el monto crudo (FX) va a auditoría, NO a la base de
        // comisiones. subscriptionPriceUsd es override MANUAL only; si está
        // vacío las comisiones usan el canónico del plan. Antes se pisaba acá
        // con el monto FX → comisiones sub-estimadas (7.43 en vez de 7.50).
        ...(realPriceUsd != null
          ? { lastPaymentAmountUsd: realPriceUsd }
          : {}),
        // Solo update si Hotmart mandó la fecha O si es primer pago
        // (fallback) — en renovaciones sin date_next_charge preservamos.
        ...(nextCharge ? { currentPeriodEnd: nextCharge } : {}),
        lastChargeAt,
        // PDF Soft 10 + FIX 2026-08-14 (R1/Fable): fecha REAL de compra — se
        // fija UNA sola vez y SOLO en la 1ª compra real. Usa la fecha aprobada
        // de Hotmart (lastChargeAt = approved_date). Es la base de la 1ª
        // comisión (purchasedAt ?? createdAt).
        //   BUG que corrige: antes era `purchasedAt ? {} : {purchasedAt:
        //   lastChargeAt}` — set-once-cuando-null. En negocios LEGACY
        //   (purchasedAt null pero YA con ciclos de cobro) eso estampaba la
        //   fecha de la RENOVACIÓN como si fuera la de compra la próxima vez
        //   que renovaban. Ahora exigimos que sea primer pago (sin
        //   currentPeriodEnd previo = misma señal que el fallback de arriba);
        //   en renovaciones de legacy dejamos purchasedAt en null para que el
        //   backfill le ponga la fecha correcta, en vez de corromperla.
        ...(planForBase?.purchasedAt || tenant.currentPeriodEnd
          ? {}
          : { purchasedAt: lastChargeAt }),
        hotmartSubscriberCode: subscriberCode ?? tenant.hotmartSubscriberCode,
        hotmartTransactionId: transactionId ?? tenant.hotmartTransactionId,
        failedPaymentCount: 0,
        // Pago confirmado → se limpia el ancla de mora para el próximo ciclo.
        firstFailedAt: null,
        lastPaymentAttemptAt: new Date(),
        suspendedAt: null,
        // 2026-06-06: el trial termina cuando hay pago confirmado. Limpiamos
        // trialEndsAt para que el dashboard no muestre "Trial: X días
        // restantes" junto con el plan pagado. trialStartedAt y trialSource
        // se preservan para analytics de conversión.
        trialEndsAt: null,
        // Reset de tracking de notificaciones para el nuevo ciclo.
        //
        // Tienen que ser los SEIS. Faltaban los tres pre-avisos, así que un
        // negocio que renovaba no volvía a recibir el aviso de 7 días, ni el
        // de 3, ni el del día — y nadie se enteraba, porque el fallo es mudo:
        // el cron los ve marcados como ya enviados para siempre.
        paymentReminderSentFor: null,
        paymentFailureNoticeSentAt: null,
        pausePendingNoticeSentAt: null,
        preReminder7dSentFor: null,
        preReminder3dSentFor: null,
        preReminderTodaySentFor: null,
      },
    });

    // Grupo empresarial: una sola suscripción de Hotmart paga por VARIOS
    // negocios, pero el webhook solo movía al que lleva el código. Los
    // hermanos se quedaban con la fecha vieja y había que corregirlos a mano
    // (grupo Aldehir, 3 cobros seguidos). Ahora avanzan juntos.
    if (nextCharge) {
      await this.propagarCicloAlGrupo(tenant.id, nextCharge).catch((e) =>
        this.logger.warn(
          `propagarCicloAlGrupo tenant=${tenant.id}: ${(e as Error).message}`,
        ),
      );
    }
    // Fase D: primer pago (TRIAL/nuevo) o reactivación (SUSPENDED) → webhook
    // business.activated. Las renovaciones (ya ACTIVE) NO disparan. tenant.status
    // acá es el estado PREVIO (se cargó antes del update).
    if (tenant.status !== 'ACTIVE') {
      void this.onboardingWebhook.emitBusinessActivated(tenant.id);
    }
    // PDF 1256 §8: auditar + limpiar la marca de liberación de crédito (para
    // permitir liberar de nuevo si el negocio se suspende en un ciclo futuro).
    await this.billing.clearCreditRelease(tenant.id).catch(() => null);
    await this.billing
      .auditLifecycle(
        wasSuspended ? 'subscription.reactivated' : 'subscription.payment_succeeded',
        tenant.id,
        { gateway: 'HOTMART', renewal: !isFirstHotmartPurchase },
      )
      .catch(() => null);
    // PDF Soft(9): ATRIBUCIÓN ROBUSTA server-side. Si el negocio no tiene
    // afiliado (el ref se perdió en el cliente — otro dispositivo/incógnito — o
    // el código estaba INACTIVO y el signup lo descartó silenciosamente → quedó
    // como "landing"), lo recuperamos del `src` que el checkout del afiliado
    // manda a Hotmart. Corre ANTES de generar la comisión para que los
    // generadores encuentren el ReferralUse recién creado.
    await this.ensureAffiliateAttributionFromSrc(tenant.id, payload).catch((e) =>
      this.logger.warn(
        `[ATTR] fallo atribución server-side: ${(e as Error).message}`,
      ),
    );

    // Comisiones del cobro. La lógica vive en un metodo aparte porque la
    // comparten las tres pasarelas — ver generarComisionesDeCobro.
    await this.generarComisionesDeCobro({
      tenantId: tenant.id,
      montoCanonicoUsd: canonicalUsd,
      transaccionId: transactionId ?? null,
    });

    // SMS al dueño (best-effort): si la cuenta venía SUSPENDED, "cuenta
    // reactivada"; si no, "pago confirmado" (con info del próximo cobro).
    if (wasSuspended) {
      this.smsTemplates
        .render('account_reactivated', { brandName: tenant.brandName }, tenant.id)
        .then((msg) => this.notifyOwner(tenant.id, tenant.brandName, msg))
        .catch(() => null);
    } else if (!alreadyConfirmedTx) {
      const nextChargeInfo = nextCharge
        ? ` Próximo cobro: ${fmtSmsDate(nextCharge)}.`
        : '';
      this.smsTemplates
        .render('payment_confirmed', {
          brandName: tenant.brandName,
          nextChargeInfo,
        }, tenant.id)
        .then((msg) => this.notifyOwner(tenant.id, tenant.brandName, msg))
        .catch(() => null);
    }
    // CORREO del mismo hecho: primera compra → "panel listo"; cuenta que
    // revivió → "reactivada"; renovación → "pago confirmado".
    if (wasSuspended || !alreadyConfirmedTx) {
      this.brandEmail
        .sendTemplate({
          templateId: wasSuspended
            ? 'email_account_reactivated'
            : isFirstHotmartPurchase
              ? 'email_panel_ready'
              : 'email_payment_confirmed',
          tenantId: tenant.id,
          vars: { nextChargeDate: nextCharge ? fmtEmailDate(nextCharge) : '' },
        })
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
      // Solo "Nueva compra" en la 1ra compra Hotmart. Renovación/re-webhook
      // (tenant con tx previa) → se omite la alerta.
      isRenewal: !isFirstHotmartPurchase,
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
    whiteLabelId?: string | null;
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
      whiteLabelId: args.whiteLabelId ?? null,
    }).catch(() => null);
  }

  /**
   * Recuperación de pago "huérfano": correo + WhatsApp/SMS al COMPRADOR con el
   * link a /activar (pre-llenado por email), y SMS al equipo comercial. Marca
   * recoveryNotifiedAt para no re-enviar en reintentos del webhook.
   *
   * Fix 2026-08-21: delega en PendingActivationService. El correo anterior
   * salía por EmailService, que sin RESEND_API_KEY en producción escribe en el
   * log y no llega a nadie — por eso se acumularon compradores que pagaron y
   * nunca supieron que debían crear su cuenta. Ahora sale por la subcuenta de
   * Grow Business de la marca (plantilla `email_buyer_activation`, editable
   * desde Automatizaciones) y el WhatsApp/SMS también sale con la identidad de
   * la marca del comprador.
   */
  private async notifyPendingRecovery(opts: {
    email: string;
    name: string | null;
    phone: string | null;
    /** null = plataforma. PendingHotmartPayment no guarda la marca, así que el
     *  reenvío manual siempre pasa null; el webhook sí conoce su scope. */
    whiteLabelId?: string | null;
  }) {
    const r = await this.pendingActivation.notifyBuyer({
      gateway: 'HOTMART',
      whiteLabelId: opts.whiteLabelId ?? null,
      email: opts.email,
      name: opts.name,
      phone: opts.phone,
    });
    // Solo marcamos si ALGO le llegó al comprador: si los dos canales fallaron
    // (caída de GHL, sin teléfono válido), dar el aviso por hecho dejaría al
    // comprador en el limbo sin que ningún reintento vuelva a intentarlo.
    if (r.emailSent || r.channel !== 'none') {
      await this.prisma.pendingHotmartPayment
        .updateMany({
          where: { email: opts.email, consumedAt: null, recoveryNotifiedAt: null },
          data: { recoveryNotifiedAt: new Date() },
        })
        .catch(() => null);
    }
  }

  /**
   * PDF Soft 10: reenvía el link de activación a un comprador Hotmart con pago
   * pendiente que aún no creó su cuenta. Reusa notifyPendingRecovery. Público
   * para el panel admin de "pagos sin activar".
   */
  async resendPendingRecovery(
    email: string,
  ): Promise<{ ok: boolean; found: boolean }> {
    const e = (email ?? '').trim().toLowerCase();
    if (!e) return { ok: false, found: false };
    const pending = await this.prisma.pendingHotmartPayment.findFirst({
      where: { email: e, consumedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    if (!pending) return { ok: false, found: false };
    const buyerAny = (pending.rawPayload as any)?.data?.buyer ?? {};
    await this.notifyPendingRecovery({
      email: pending.email,
      name: buyerAny?.name ?? null,
      phone: buyerAny?.checkout_phone ?? buyerAny?.phone ?? null,
    }).catch(() => null);
    return { ok: true, found: true };
  }

  /**
   * PDF Soft 10: lista unificada de compras PAGADAS pero SIN cuenta activada
   * (los 3 Pending*Payment sin consumir). Para el panel admin: datos del
   * comprador (nombre/correo/teléfono/monto/fecha real) + link de activación
   * para reenviar. Solo lectura.
   */
  async listPendingPayments() {
    const appUrl = process.env.APP_URL ?? 'https://soyclubify.com';
    const link = (email: string) =>
      `${appUrl}/activar?email=${encodeURIComponent(email)}`;
    const now = Date.now();
    const ageHours = (d: Date) =>
      Math.max(0, Math.round((now - new Date(d).getTime()) / 3600000));

    const [hot, stripe, cross] = await Promise.all([
      this.prisma.pendingHotmartPayment.findMany({
        where: { consumedAt: null },
        orderBy: { createdAt: 'desc' },
        take: 200,
      }),
      this.prisma.pendingStripePayment.findMany({
        where: { consumedAt: null },
        orderBy: { createdAt: 'desc' },
        take: 200,
      }),
      this.prisma.pendingCrossPayment.findMany({
        where: { consumedAt: null },
        orderBy: { createdAt: 'desc' },
        take: 200,
      }),
    ]);

    type Row = {
      /** id de la fila en SU tabla Pending* — lo necesita «Asignar a negocio». */
      id: string;
      gateway: 'HOTMART' | 'STRIPE' | 'CROSS';
      email: string;
      name: string | null;
      phone: string | null;
      /** Precio PACTADO del plan en USD (68/150/278/500). Es el que manda. */
      amountUsd: number | null;
      /** Lo que Hotmart dijo, tal cual, con su moneda. Solo informativo. */
      paidRaw: number | null;
      paidCurrency: string | null;
      /** MENSUAL|TRIMESTRAL|… deducida del plan del pago, si vino. */
      periodicity: string | null;
      purchaseDate: string | null;
      activationLink: string;
      createdAt: Date;
      ageHours: number;
    };
    const out: Row[] = [];

    for (const p of hot) {
      const raw = (p.rawPayload as any) ?? {};
      const buyer = raw?.data?.buyer ?? {};
      const approved = raw?.data?.purchase?.approved_date;
      // El monto se mostraba en CRUDO como si fuera USD, y Hotmart manda el
      // valor en la moneda del producto: salían cifras como $501.764,21, que
      // son pesos. La regla del negocio es la misma que ya usa el cálculo de
      // comisiones (`resolvePaidUsd`): manda el precio PACTADO del plan, no lo
      // que diga el payload. Ojo, la moneda viene en `currency_value`, no en
      // `currency_code` — mirar solo el segundo fue el bug original.
      const precio = raw?.data?.purchase?.price ?? {};
      const priceVal = typeof precio.value === 'number' ? precio.value : null;
      const moneda = String(
        precio.currency_code || precio.currency_value || '',
      ).toUpperCase() || null;
      const periodicity = parsePlanPeriodLabel(
        raw?.data?.subscription?.plan?.name ?? '',
      );
      const canonico = await this.getCanonicalBundlePrice(periodicity);
      // Se acepta el valor del payload solo si dice USD y cae en la banda del
      // plan; si no, se muestra el pactado. Nunca una cifra inventada.
      const enBanda =
        priceVal != null &&
        canonico > 0 &&
        priceVal >= canonico * 0.3 &&
        priceVal <= canonico * 1.6;
      const amountUsd =
        priceVal != null && (!moneda || moneda === 'USD') && enBanda
          ? priceVal
          : canonico > 0
            ? canonico
            : null;
      out.push({
        id: p.id,
        gateway: 'HOTMART',
        email: p.email,
        name: buyer?.name ?? null,
        phone: buyer?.checkout_phone ?? buyer?.phone ?? null,
        amountUsd,
        paidRaw: priceVal,
        paidCurrency: moneda,
        periodicity,
        purchaseDate:
          typeof approved === 'number'
            ? new Date(approved).toISOString()
            : null,
        activationLink: link(p.email),
        createdAt: p.createdAt,
        ageHours: ageHours(p.createdAt),
      });
    }
    for (const p of stripe) {
      const obj = (p.rawPayload as any)?.data?.object ?? {};
      const cd = obj?.customer_details ?? {};
      const created = (p.rawPayload as any)?.created;
      const amt =
        typeof obj?.amount_total === 'number' ? obj.amount_total / 100 : null;
      out.push({
        id: p.id,
        gateway: 'STRIPE',
        email: p.email,
        name: cd?.name ?? null,
        phone: cd?.phone ?? null,
        // Stripe sí manda la moneda fiable, así que se respeta: si no es USD,
        // el monto en dólares queda en null en vez de mentir.
        amountUsd: obj?.currency === 'usd' ? amt : null,
        paidRaw: amt,
        paidCurrency: obj?.currency ? String(obj.currency).toUpperCase() : null,
        periodicity: null,
        purchaseDate:
          typeof created === 'number'
            ? new Date(created * 1000).toISOString()
            : p.createdAt.toISOString(),
        activationLink: link(p.email),
        createdAt: p.createdAt,
        ageHours: ageHours(p.createdAt),
      });
    }
    for (const p of cross) {
      const cust =
        (p.rawPayload as any)?.customer ??
        (p.rawPayload as any)?.data?.customer ??
        {};
      out.push({
        id: p.id,
        gateway: 'CROSS',
        email: p.email,
        name: cust?.name ?? null,
        phone: cust?.phone ?? null,
        // Cross guarda el importe ya en USD en su propia columna.
        amountUsd: p.amountUsd != null ? Number(p.amountUsd) : null,
        paidRaw: p.amountUsd != null ? Number(p.amountUsd) : null,
        paidCurrency: 'USD',
        periodicity: null,
        purchaseDate: p.createdAt.toISOString(),
        activationLink: link(p.email),
        createdAt: p.createdAt,
        ageHours: ageHours(p.createdAt),
      });
    }
    out.sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
    return out;
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
          firstFailedAt: true,
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
            firstFailedAt: true,
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
  /**
   * Genera las comisiones de un COBRO CONFIRMADO. Agnóstica de pasarela.
   *
   * Vive en este archivo por historia — nació dentro del webhook de Hotmart —
   * pero no depende de Hotmart: la base de la comisión sale del override
   * manual del tenant o del precio canónico del plan según su periodicidad,
   * NUNCA del monto crudo que mandó la pasarela (que llega con FX aplicado).
   *
   * Por eso la llaman también **Stripe y Cross**: sin esto, una marca que
   * cobra por Stripe (Sellea) podía tener afiliados, enlaces y atribución
   * funcionando y no generar NI UNA comisión — el panel se veía bien hasta
   * que tocaba pagar.
   *
   * Idempotente: dedup por transacción y por período (25 días).
   *
   * @param transaccionId id de la transacción en la pasarela, si lo hay. Es la
   *        clave de deduplicación; sin él manda el dedup por período.
   */
  async generarComisionesDeCobro(opts: {
    tenantId: string;
    montoCanonicoUsd?: number | null;
    transaccionId?: string | null;
  }) {
    const { tenantId, transaccionId } = opts;
    const montoCanonicoUsd = opts.montoCanonicoUsd ?? null;
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
          tenantId: tenantId,
          referralCode: { role: 'VENDOR' },
          status: { in: ['PAYING', 'ACTIVE'] },
        },
        orderBy: { createdAt: 'desc' },
        select: { id: true },
      });
      if (vendorUse) {
        // Defensa FIXED_ONCE (Sellea): una marca en modo fijo paga monto
        // ÚNICO por el flujo legacy (generateReferralCommission), NUNCA el 3-way
        // de porcentaje. Sellea no tiene vendors, pero blindamos por si un code
        // cross-brand se colara al tenant. El check solo corre cuando hay
        // vendorUse (raro) → no pesa en el hot path del caso común.
        const tFixed = await this.prisma.tenant.findUnique({
          where: { id: tenantId },
          select: { whiteLabelId: true },
        });
        const isFixedOnce =
          (await this.referralsService.getBrandCommissionModeByWhiteLabelId(
            tFixed?.whiteLabelId ?? null,
          )) === 'FIXED_ONCE';
        if (isFixedOnce) {
          await this.generateReferralCommission({
            tenantId,
            paidAmount: null,
            transactionId: transaccionId ?? undefined,
          });
        } else {
          // 2026-07-31: la base la resuelve el generador (override manual del
          // tenant o canónico del plan), NUNCA el monto crudo pagado (FX). No le
          // pasamos el monto de Hotmart; paymentAmountUsd queda como compat.
          await this.referralsService.generateCommissionsForPayment({
            tenantId: tenantId,
            // `paymentAmountUsd` es compat: el generador resuelve la base por su
            // cuenta. Cuando la pasarela no manda monto (Stripe/Cross) va 0.
            paymentAmountUsd: montoCanonicoUsd ?? 0,
            hotmartTransactionId: transaccionId ?? null,
          });
        }
      } else {
        // La base se resuelve dentro (override manual → canónico). No pasamos
        // el monto crudo de Hotmart.
        await this.generateReferralCommission({
          tenantId: tenantId,
          paidAmount: null,
          transactionId: transaccionId ?? undefined,
        });
      }
    } catch (e) {
      this.logger.warn(
        `generación de comisión falló: ${(e as Error).message}`,
      );
    }
  }

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
      select: {
        lastChargeAt: true,
        subscriptionPriceUsd: true,
        planPeriodicity: true,
        whiteLabelId: true,
      },
    });
    // COMISIÓN FIJA (EXCLUSIVO Sellea): si la marca de la venta está en modo
    // FIXED_ONCE, la comisión directa es un MONTO FIJO pagado UNA sola vez
    // (nunca %, nunca recurrente, sin indirecta, sin socio). Clubify y demás
    // marcas → false → todo el flujo histórico queda intacto.
    const saleBrandSlug = await this.referralsService.slugForWhiteLabelId(
      tenant?.whiteLabelId ?? null,
    );
    const fixedOnceBrand =
      (await this.referralsService.getBrandCommissionMode(saleBrandSlug)) ===
      'FIXED_ONCE';
    // 2026-07-31: la base de comisión es SIEMPRE el override manual del tenant
    // (subscriptionPriceUsd, si está seteado >0) o el canónico del plan por
    // periodicidad — NUNCA el monto crudo (FX) pagado en Hotmart (opts.paidAmount
    // ya no se usa como base). Así 5% de un trimestral = 5% de 150 = 7.50, no
    // 5% de 148.65 = 7.43.
    const canonicalBase = await this.getCanonicalBundlePrice(
      tenant?.planPeriodicity ?? null,
    );
    const manualOverride =
      tenant?.subscriptionPriceUsd != null &&
      Number(tenant.subscriptionPriceUsd) > 0
        ? Number(tenant.subscriptionPriceUsd)
        : null;
    const commissionBase = manualOverride ?? canonicalBase;
    if (!commissionBase || commissionBase <= 0) {
      this.logger.warn(`Skip comisión: sin base canónica para tenant=${opts.tenantId}`);
      return;
    }
    // P3 2026-07-02: la comisión se desbloquea 15 días DESPUÉS del pago real en
    // Hotmart (Tenant.lastChargeAt, seteado por activatePurchase antes de esto).
    // GUARD B6/R4: holdReleaseFrom clampa si lastChargeAt está viejo.
    const commissionAvailableAt = holdReleaseFrom(tenant?.lastChargeAt);

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
    const referralBase = commissionBase;
    const socioBase = commissionBase;

    if (use) {
      const last = use.commissions[0];
      // FIX 2026-07-05 (comisiones de renovación no se generaban): el guard de
      // "ventana <25 días" es SOLO un fallback para cuando NO hay transactionId
      // (no podemos deduplicar con precisión). Con transactionId, la dedup exacta
      // por externalTxId (duplicateByTx, abajo) ya cubre los reintentos de
      // webhook, y CADA cobro nuevo (tx distinta) DEBE generar su comisión aunque
      // el ciclo anterior sea reciente. Antes, un cobro mensual que llegaba a los
      // ~21 días (ej. Quipao/Wok Explosivo) se saltaba como "duplicado" y
      // Sara/nico no cobraban su comisión de la renovación.
      const recent =
        !opts.transactionId &&
        last &&
        (Date.now() - new Date(last.createdAt).getTime()) / 86400_000 < 25;

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
        // MONTO + periodKey según el modo de la marca de la venta.
        let direct: number;
        let periodKey: string;
        let logDetalle: string;
        if (fixedOnceBrand) {
          // Monto FIJO en USD, PAGO ÚNICO. La cantidad sale del propio código
          // (negocio = $30 seteado al crearlo) o, si no la trae, por rol desde
          // la config de la marca (influencer $80 / embajador $40). periodKey
          // CONSTANTE 'ONCE' → la @@unique([referralUseId,recipientCodeId,periodKey])
          // impide un segundo pago PARA SIEMPRE (renovaciones y reintentos).
          direct =
            use.referralCode.fixedCommissionUsd != null
              ? Number(use.referralCode.fixedCommissionUsd)
              : await this.referralsService.getBrandFixedAmount(
                  saleBrandSlug,
                  use.referralCode.role === 'AMBASSADOR' ? 'embajador' : 'influencer',
                );
          periodKey = 'ONCE';
          logDetalle = `$${direct} FIJO/único`;
        } else {
          // Item 6 sprint: si el SUPER_ADMIN configuró una excepción para
          // este (tenant, recipientCode), el % de la excepción gana.
          const pct = await this.resolvePercent(
            opts.tenantId,
            use.referralCode.id,
            Number(use.referralCode.commissionPercent ?? COMMISSION_DEFAULTS.ambassadorPct),
          );
          direct = round2((referralBase * pct) / 100);
          periodKey = monthKey();
          logDetalle = `$${direct} (${pct}% sobre $${referralBase})`;
        }

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
              periodKey,
              availableAt: commissionAvailableAt,
            },
          })
          .catch((e: any) => {
            if (e?.code === 'P2002') {
              this.logger.warn(
                `generateReferralCommission: skip dup directa (useId=${use.id}, code=${use.referralCode.id}, periodKey=${periodKey})`,
              );
              return null;
            }
            throw e;
          });
        this.logger.log(
          `Comisión directa: ${use.referralCode.role} ${use.referralCode.code} ${logDetalle}`,
        );

        // Indirecta: si es embajador, su influencer parent gana 5% por default.
        // Configurable más adelante via Setting key `referrals.indirectPercent`.
        // FIXED_ONCE (Sellea) NO tiene indirecta: son rangos planos sin jerarquía.
        if (!fixedOnceBrand && use.referralCode.role === 'AMBASSADOR' && use.referralCode.parentCode) {
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
                availableAt: commissionAvailableAt,
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
    // EXCEPCIÓN Sellea (FIXED_ONCE): las ventas de una marca en modo fijo NO
    // generan comisión de socio — el socio global es un acuerdo de Clubify y no
    // debe arrastrarse a la marca blanca (decidido con el founder, 2026-08-27).
    if (!fixedOnceBrand) {
      await this.generateSocioCommission(
        opts.tenantId,
        socioBase,
        commissionAvailableAt,
        opts.transactionId,
      ).catch((e) =>
        this.logger.warn(`Comisión socio falló: ${(e as Error).message}`),
      );
    }
  }

  private async generateSocioCommission(
    tenantId: string,
    amountPaid: number,
    availableAt?: Date,
    transactionId?: string | null,
  ) {
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
    // Dedup exacta por transacción: si ya existe una comisión socio con este
    // mismo externalTxId, es un reintento del webhook → skip.
    if (transactionId) {
      const existingTx = await this.prisma.commission.findFirst({
        where: { externalTxId: transactionId, referralUseId: use.id },
        select: { id: true },
      });
      if (existingTx) return;
    }
    // FIX 2026-07-05: la ventana <25 días es solo fallback SIN transactionId.
    // Con tx, cada cobro genera su comisión socio (antes se saltaban las
    // renovaciones mensuales que caían a ~21 días del ciclo anterior).
    const last = use.commissions[0];
    if (
      !transactionId &&
      last &&
      (Date.now() - new Date(last.createdAt).getTime()) / 86400_000 < 25
    ) {
      return; // mismo ciclo
    }
    await this.prisma.commission
      .create({
        data: {
          referralUseId: use.id,
          amount,
          status: 'PENDING',
          externalTxId: transactionId ?? null,
          recipientCodeId: socio.id,
          periodKey: monthKey(),
          availableAt: availableAt ?? null,
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
    isRenewal?: boolean;
  }) {
    const { tenantId, brandName, nextCharge, transactionId, isRenewal } = opts;

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

    // C2.1 — Alerta al equipo comercial. SOLO en compra NUEVA. En renovaciones
    // o re-webhooks de un cliente ya activo NO se reenvía (antes llegaba "Nueva
    // compra" a clientes que compraron días antes — bug PDF 854).
    if (!isRenewal) {
      await this.alerts
        .sendTeamAlert(
          `🎉 Nueva compra Clubify\nCliente: ${brandName}\nEmail: ${email}\nPlan: ${planName}\nPróximo cobro: ${nextCharge.toLocaleDateString('es-CO')}`,
          'nueva_compra',
        )
        .catch((e) =>
          this.logger.warn(
            `sendTeamAlert post-purchase falló: ${(e as Error)?.message ?? e}`,
          ),
        );
    } else {
      this.logger.log(
        `postPurchaseFanOut: renovación/re-webhook de ${brandName} — se omite alerta "Nueva compra".`,
      );
    }

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
