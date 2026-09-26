import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../common/prisma/prisma.service';
import { GrowBusinessService } from '../integrations/grow-business.service';
import { brandGrowCreds, BRAND_GROW_SELECT } from '../integrations/brand-sms-creds.util';
import { SmsTemplatesService } from './sms-templates.service';
import { fmtSmsDate } from './sms-templates';
import { BrandEmailService } from '../email/brand-email.service';
import { fmtEmailDate } from '../email/brand-email-templates';
import { addPlanPeriod } from '../common/plan-period';
import { cycleCreditCostForTenant } from '../common/business-types';
import { AuditService } from '../audit/audit.service';
import { PreregAlertsService } from '../auth/prereg-alerts.service';
import {
  decideDunning,
  esMoraFantasma,
  pauseDateFor,
  deriveRenewalState,
  type RenewalStateResult,
} from './dunning';
import { diasDeFechaTardia } from './fecha-de-cobro';
import { desconectaAlCancelar } from './cancelacion';
import { invalidateTenantStatusCache } from '../common/guards/tenant-status.guard';
import { horaLocal, fechaLocal } from '../automations/hora-local';
import {
  CLAVE_ULTIMA_PASADA,
  CLAVE_VENTANA,
  dentroDeLaVentana,
  leerVentana,
  normalizarVentana,
  type VentanaDeEnvio,
} from './ventana-de-envio';

// Fase 3 (2026-08-31): alertas internas de cobro al equipo. Se envían por la
// subcuenta GB del equipo (sendInternalAlert) — la misma probada con el SMS de
// pagos. La spec pedía enviar DESDE +573167689240, pero ese número no está en el
// sistema; cuando su subcuenta exista, se cambia solo el remitente ahí.
const BILLING_ALERT_PHONES = [
  '+573135618300',
  '+573181666999',
  '+573248088401',
];

export type MotivoDeBaja = 'cancelacion' | 'reembolso' | 'contracargo';

/**
 * El SMS al equipo cuando un negocio se va. Hasta el 15-09-2026 una
 * cancelación no le avisaba a nadie de dentro. Dice si ya se desconectó o
 * hasta cuándo sigue, que es lo primero que se pregunta al leerlo.
 */
export function textoDeCancelacion(
  brandName: string,
  motivo: MotivoDeBaja,
  estado: { desconectado: boolean; hasta: Date | null },
): string {
  const que =
    motivo === 'reembolso'
      ? '💸 REEMBOLSO'
      : motivo === 'contracargo'
        ? '💸 CONTRACARGO'
        : '🚫 CANCELÓ la suscripción';
  const cuando = estado.desconectado
    ? ' Servicio desconectado.'
    : estado.hasta
      ? ` Pagó hasta el ${estado.hasta.toLocaleDateString('es-CO', {
          day: '2-digit',
          month: '2-digit',
          year: 'numeric',
          timeZone: 'America/Bogota',
        })}: ese día se desconecta solo.`
      : '';
  return `${que}: ${brandName}.${cuando} (Clubify)`;
}

// Secuencia de mora (PDF 2026-07-01, P4). Día 0 = 1er cobro fallido o fecha
// de cobro vencida (lo que ocurra). El cron diario cuenta días calendario:
//   D+1 → recordatorio · D+2 → último aviso "mañana se pausa".
// 2026-08-31: la gracia por defecto pasó de 3 a 5 días (decisión del dueño).
// La gracia cubre los días 1..N; al día N+1 se auto-suspende (con N=5 → día 6).
const OVERDUE_REMINDER_DAY = 1;  // D+1 recordatorio
const OVERDUE_NOTICE_DAY = 2;    // D+2 aviso de pausa
const PAUSE_DAYS = 5;            // gracia por defecto (1..5) → día 6 suspende
// Más allá de este umbral asumimos data legacy (currentPeriodEnd viejo que
// nunca avanzó) y NO auto-suspendemos por la vía de "fecha vencida", para no
// pausar en masa cuentas antiguas al desplegar. La vía de cobro fallido
// (failedPaymentCount>0) no tiene este tope: es señal explícita de Hotmart.
const STALE_OVERDUE_CAP_DAYS = 60;
// Fase 2: un cobro dentro de estos días cuenta como "próximo" (dashboard 🔴).
const PROXIMO_COBRO_DAYS = 7;

export type TrialStatus = {
  status: 'TRIAL' | 'ACTIVE' | 'PAST_DUE' | 'SUSPENDED' | 'EXPIRED' | 'CANCELED';
  trialEndsAt: Date | null;
  daysLeftInTrial: number | null;
  currentPeriodEnd: Date | null;
  isActiveAccess: boolean;
  // Gracia post-trial: si trialEndsAt ya pasó pero queda gracia, el dueño
  // sigue con acceso. Estos campos permiten al frontend mostrar un banner
  // específico "trial vencido — X días de gracia restantes".
  gracePeriodDays: number;
  inGracePeriod: boolean;
  graceDaysLeft: number | null;
  // Prueba PAGA (tarjeta anclada, ej. enlace de 7 días de Sellea): el negocio
  // está en TRIAL pero ya tiene suscripción de Stripe y el cobro es automático
  // al terminar la prueba. Distinto de la prueba GRATIS (sin tarjeta), que sí
  // pide "completar el pago". El frontend usa esto para el copy correcto.
  paidTrial: boolean;
  // Fase 2: estado del ciclo de RENOVACIÓN/cobro (mora de dinero), derivado con
  // la MISMA regla que suspende (decideDunning). Distinto de la gracia de prueba
  // de arriba. Alimenta el panel del negocio y el dashboard de cobros.
  renewal: RenewalStateResult;
  /**
   * El dueño CANCELÓ la renovación y todavía le quedan días pagados.
   *
   * Cancelar ya no desconecta en el acto —eso se arregló el 2026-09-23, caso
   * LICORES EL AMANECER, que perdió tres días que había pagado—, pero el panel
   * no se enteraba: `getStatus` no devolvía nada de la cancelación, así que el
   * negocio cancelaba, seguía viendo todo normal y no tenía forma de saber
   * hasta cuándo. Con esto se puede pintar el aviso.
   *
   * `canceladaHasta` es el último día con acceso. Null = no ha cancelado.
   */
  canceledAt: Date | null;
  canceladaHasta: Date | null;
};

const TRIAL_DAYS = 10;

@Injectable()
export class BillingService {
  private logger = new Logger(BillingService.name);

  constructor(
    private prisma: PrismaService,
    private growBusiness: GrowBusinessService,
    private smsTemplates: SmsTemplatesService,
    private brandEmail: BrandEmailService,
    private audit: AuditService,
    private prereg: PreregAlertsService,
  ) {}

  /**
   * Fase 3 — alerta interna de cobro al equipo (los 3 números). `kind`:
   * 'renovacion_fallida' (1er cobro fallido), 'suspendido' (auto-suspensión),
   * 'cancelado' (canceló, reembolso o contracargo; ver `textoDeCancelacion`).
   * Best-effort, no bloquea. Enviado por la subcuenta del equipo.
   */
  async notifyBillingTeam(
    kind:
      | 'renovacion_fallida'
      | 'suspendido'
      | 'pago_procesado'
      | 'autoreactivado'
      | 'cancelado',
    brandName: string,
    opts?: {
      amountUsd?: number | null;
      renewal?: boolean;
      dias?: number;
      /** Solo en 'cancelado': por qué se va. */
      motivo?: MotivoDeBaja;
      /** Solo en 'cancelado': ya quedó desconectado (ahora o antes). */
      desconectado?: boolean;
      /** Solo en 'cancelado': hasta cuándo sigue activo, si no se desconectó. */
      hasta?: Date | null;
    },
  ): Promise<void> {
    const body =
      kind === 'cancelado'
        ? textoDeCancelacion(brandName, opts?.motivo ?? 'cancelacion', {
            desconectado: opts?.desconectado ?? false,
            hasta: opts?.hasta ?? null,
          })
        : kind === 'renovacion_fallida'
        ? `⚠️ Cobro FALLIDO: ${brandName}. Entró en gracia (5 días). Revisar en Clubify.`
        : kind === 'suspendido'
          ? `🔴 SUSPENDIDO por falta de pago: ${brandName}. Revisar en Clubify.`
          : kind === 'autoreactivado'
            ? `🟡 ${brandName} se reactivó SOLO por ${opts?.dias ?? 3} días para ir a pagar. Si no paga, vuelve a pausarse. (Clubify)`
            : `✅ Pago procesado${opts?.renewal ? ' (renovación)' : ''}: ${brandName}. (Clubify)`;
    await Promise.all(
      BILLING_ALERT_PHONES.map((phone) =>
        this.prereg
          .sendInternalAlert(phone, body)
          .catch((e) =>
            this.logger.warn(
              `notifyBillingTeam a ${phone} falló: ${(e as Error).message}`,
            ),
          ),
      ),
    );
  }

  /** Fase 3 — envío de PRUEBA de la alerta de cobro a los 3 números. */
  async testBillingTeamAlert(): Promise<{ ok: boolean; phones: string[] }> {
    const results = await Promise.all(
      BILLING_ALERT_PHONES.map((phone) =>
        this.prereg
          .sendInternalAlert(
            phone,
            '🧪 Prueba · alertas internas de cobro (cobro fallido / suspensión) activas. (Clubify)',
          )
          .then((r) => r.ok)
          .catch(() => false),
      ),
    );
    return { ok: results.some(Boolean), phones: BILLING_ALERT_PHONES };
  }

  // ── PDF 1256 §2/§8: gracia configurable, liberación de crédito, auditoría ──

  /** Días de gracia antes de suspender por mora. Configurable desde el panel
   *  (Setting `billing.graceDays`). Default 5. Rango 1..30. La gracia cubre los
   *  días 1..N; al día N+1 se suspende (ver processOverdueAccounts). */
  async getGraceDays(): Promise<number> {
    const row = await this.prisma.setting
      .findUnique({ where: { key: 'billing.graceDays' } })
      .catch(() => null);
    const n = row?.value != null ? parseInt(row.value, 10) : NaN;
    return Number.isFinite(n) && n >= 1 && n <= 30 ? n : PAUSE_DAYS;
  }

  async setGraceDays(days: number): Promise<number> {
    const n = Math.max(1, Math.min(30, Math.round(days)));
    await this.prisma.setting.upsert({
      where: { key: 'billing.graceDays' },
      update: { value: String(n) },
      create: { key: 'billing.graceDays', value: String(n) },
    });
    return n;
  }

  /** Auditoría best-effort de un evento del ciclo de suscripción (PDF 1256 §8). */
  async auditLifecycle(
    action: string,
    tenantId: string | null,
    metadata: Record<string, unknown> = {},
  ) {
    await this.audit
      .log({ tenantId: tenantId ?? undefined, action, resource: 'subscription', metadata })
      .catch(() => null);
  }

  /**
   * PDF 1256 §2: al suspender un negocio de MARCA BLANCA que había consumido un
   * crédito, se devuelve 1 crédito al inventario de la marca. Idempotente
   * (creditReleasedAt): nunca libera 2 veces el mismo ciclo. NO aplica a Clubify
   * (paga directo, sin crédito) ni a marcas ilimitadas. Auditado.
   */
  async releaseBrandCreditOnSuspend(tenantId: string, reason: string): Promise<boolean> {
    const t = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: {
        id: true,
        brandName: true,
        creditReleasedAt: true,
        whiteLabelId: true,
        businessType: true,
        infolinkTier: true,
        planPeriodicity: true,
        whiteLabel: { select: { id: true, slug: true, creditsUnlimited: true } },
      },
    });
    if (!t || t.creditReleasedAt) return false; // ya liberado este ciclo
    const wl = t.whiteLabel;
    if (!wl || wl.slug === 'clubify' || wl.creditsUnlimited) return false; // no aplica
    // Evidencia de que se consumió un crédito por este negocio (si nunca se
    // consumió, no hay nada que devolver).
    const consumed = await this.prisma.creditTransaction.findFirst({
      where: { whiteLabelId: wl.id, tenantId: t.id, type: 'CONSUME' },
      select: { id: true },
    });
    if (!consumed) return false;
    // Se libera el costo del ciclo según el tipo de negocio × periodicidad
    // (mismo valor que se cobró al activar/renovar: InfoLink mensual = 0.1).
    const cost = cycleCreditCostForTenant(t.businessType, t.infolinkTier, t.planPeriodicity);
    // Devolver el crédito + registrar en el ledger + auditar. Marca idempotente.
    await this.prisma.$transaction([
      this.prisma.whiteLabel.update({
        where: { id: wl.id },
        data: { creditsAvailable: { increment: cost } },
      }),
      this.prisma.creditTransaction.create({
        data: {
          whiteLabelId: wl.id,
          tenantId: t.id,
          type: 'REFUND',
          amount: cost,
          note: `Crédito liberado por suspensión (${reason})`,
        },
      }),
      this.prisma.tenant.update({
        where: { id: t.id },
        data: { creditReleasedAt: new Date() },
      }),
    ]);
    await this.auditLifecycle('subscription.credit_released', t.id, {
      whiteLabelId: wl.id,
      reason,
    });
    this.logger.log(`Crédito liberado a marca ${wl.slug} por suspensión de ${t.brandName} (${reason})`);
    return true;
  }

  /** Limpia la marca de liberación al reactivar/renovar (permite liberar en un
   *  ciclo futuro). Best-effort. */
  async clearCreditRelease(tenantId: string) {
    await this.prisma.tenant
      .update({ where: { id: tenantId }, data: { creditReleasedAt: null } })
      .catch(() => null);
  }

  /**
   * Helper: encontrar el celular del dueño para SMS. Prioridad:
   *   1. user.phone (TENANT_OWNER)
   *   2. tenant.whatsappPhone
   *   3. tenant.phone
   * Devuelve null si no hay ninguno → silently skip el SMS.
   */
  private async ownerPhone(tenantId: string): Promise<string | null> {
    const owner = await this.prisma.user.findFirst({
      where: { tenantId, role: 'TENANT_OWNER', isActive: true },
      select: { phone: true },
      orderBy: { createdAt: 'asc' },
    });
    if (owner?.phone?.trim()) return owner.phone;
    const t = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { whatsappPhone: true, phone: true },
    });
    // `||` y no `??`: el panel guardaba el campo vacío como '' y `'' ?? phone`
    // es ''. Así Hydor, Dolce vita, Cocoa Beauty y La Gloriosa se quedaban sin
    // un solo SMS de cobro teniendo un número bueno justo al lado.
    return t?.whatsappPhone?.trim() || t?.phone?.trim() || null;
  }

  /**
   * Resuelve credenciales + teléfono destino para enviar un SMS de
   * billing al tenant. Centraliza la lógica para que billing.service y
   * hotmart.service consuman desde aquí.
   *
   * Retorna null cuando: alertas apagadas explícitamente, sin creds
   * disponibles (ni subcuenta global ni propias del tenant), o sin
   * teléfono destino.
   *
   * Prioridades:
   *  - Creds:  billingAlertsAccountId (subcuenta global)  >  growBusiness* del tenant
   *  - Teléfono: billingAlertsPhone (override)  >  cascada ownerPhone()
   */
  async resolveBillingTarget(tenantId: string): Promise<{
    creds: { locationId: string; apiKey: string; switchNumber: number | null };
    phone: string;
  } | null> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: {
        id: true,
        billingAlertsEnabled: true,
        billingAlertsPhone: true,
        billingAlertsAccountId: true,
        growBusinessLocationId: true,
        growBusinessApiKey: true,
        growBusinessSwitchNumber: true,
        whiteLabel: {
          select: {
            ...BRAND_GROW_SELECT,
            // P6 (PDF245): la subcuenta de la MARCA solo se usa si tiene el
            // módulo GROW_BUSINESS_SMS activo.
            modules: {
              where: { module: 'GROW_BUSINESS_SMS' },
              select: { enabled: true },
            },
          },
        },
      },
    });
    // Estas dos salidas son SILENCIOSAS a propósito: no hay nada que arreglar.
    // `billingAlertsEnabled=false` es una decisión del negocio, y avisarlo en
    // cada cobro sería ruido que tapa los casos que sí importan.
    if (!tenant || !tenant.billingAlertsEnabled) return null;

    let creds: {
      locationId: string;
      apiKey: string;
      switchNumber: number | null;
    } | null = null;
    if (tenant.billingAlertsAccountId) {
      const acc = await this.prisma.growBusinessAccount.findFirst({
        where: { id: tenant.billingAlertsAccountId, deletedAt: null },
        select: { locationId: true, apiKey: true, switchNumber: true },
      });
      if (acc) {
        creds = {
          locationId: acc.locationId,
          apiKey: acc.apiKey,
          switchNumber: acc.switchNumber,
        };
      }
    }
    if (!creds && tenant.growBusinessLocationId && tenant.growBusinessApiKey) {
      creds = {
        locationId: tenant.growBusinessLocationId,
        apiKey: tenant.growBusinessApiKey,
        switchNumber: tenant.growBusinessSwitchNumber,
      };
    }
    // Capa MARCA (P6 PDF245): la subcuenta GHL de la marca blanca solo se usa si
    // la marca tiene el módulo GROW_BUSINESS_SMS ACTIVO (nunca la de Clubify).
    // Las creds propias del negocio y la subcuenta global asignada no dependen
    // del módulo (ya se resolvieron arriba).
    if (!creds) {
      const smsModuleOn =
        tenant.whiteLabel?.modules?.some((m) => m.enabled) ?? false;
      if (smsModuleOn) creds = brandGrowCreds(tenant.whiteLabel);
    }
    // A partir de acá SÍ es mala configuración, y hasta ahora se iba en
    // silencio: los tres notifyOwner (Hotmart/Stripe/Cross) hacen
    // `if (!target) return;` sin log, así que un negocio con los avisos
    // ENCENDIDOS pero sin subcuenta o sin teléfono no recibía el SMS de su
    // cobro y no quedaba rastro de por qué. Se avisa acá, que es el único sitio
    // que conoce el motivo, y las tres pasarelas lo heredan.
    if (!creds) {
      this.logger.warn(
        `[AVISOS-COBRO] tenant ${tenantId}: los avisos están ENCENDIDOS pero no ` +
          `hay por dónde enviar (sin subcuenta asignada, sin credenciales propias, ` +
          `y la marca no tiene GROW_BUSINESS_SMS activo). No se envió el SMS.`,
      );
      return null;
    }

    const phone =
      tenant.billingAlertsPhone?.trim() || (await this.ownerPhone(tenantId));
    if (!phone) {
      this.logger.warn(
        `[AVISOS-COBRO] tenant ${tenantId}: hay por dónde enviar pero no A QUIÉN ` +
          `(sin billingAlertsPhone y sin teléfono del dueño). No se envió el SMS.`,
      );
      return null;
    }

    return { creds, phone };
  }

  /**
   * El dueño cancela desde su panel (`POST /billing/cancel`).
   *
   * EL FALLO (LICORES EL AMANECER, 2026-09-23): esto suspendía EN EL ACTO. El
   * negocio había pagado su trimestre hasta el 26, recibió a las 14:00 el SMS
   * de «te cobramos en 3 días», entró a cancelar la renovación a las 14:08… y
   * perdió los tres días que ya tenía pagados. La función incluso calculaba
   * `accessUntil` con la fecha correcta, se la devolvía a la pantalla, y
   * suspendía igual.
   *
   * La regla correcta ya existía y es la misma que aplica el webhook de la
   * pasarela: `desconectaAlCancelar`. Cancelar avisa de que NO se renueve; no
   * renuncia a lo pagado. Las dos puertas deciden ahora con el mismo criterio.
   *
   * Tampoco marcaba `canceledAt`, así que el cron de cobro seguía tratando al
   * negocio como si fuera a renovar, y no dejaba rastro en la auditoría: la
   * suspensión aparecía de la nada y no había forma de saber quién la hizo.
   */
  async cancelSubscription(tenantId: string, reason?: string) {
    const t = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: {
        id: true,
        brandName: true,
        status: true,
        trialEndsAt: true,
        currentPeriodEnd: true,
        failedPaymentCount: true,
      },
    });
    if (!t) throw new Error('Tenant not found');

    const now = new Date();
    const desconectarYa = desconectaAlCancelar(t, now);
    await this.prisma.tenant.update({
      where: { id: tenantId },
      data: {
        canceledAt: now,
        ...(desconectarYa ? { status: 'SUSPENDED' as const, suspendedAt: now } : {}),
      },
    });
    invalidateTenantStatusCache(tenantId);

    const accessUntil = t.currentPeriodEnd ?? t.trialEndsAt;
    this.audit.log({
      actorId: null,
      tenantId,
      action: 'billing.canceled_by_owner',
      resource: `tenant:${tenantId}`,
      metadata: {
        brandName: t.brandName,
        reason: reason?.trim() || null,
        previousStatus: t.status,
        suspendedNow: desconectarYa,
        accessUntil: accessUntil?.toISOString() ?? null,
      },
    });
    this.logger.log(
      `Tenant ${tenantId} canceló su suscripción. ` +
        (desconectarYa
          ? 'Sin días pagados por delante: desconectado.'
          : `Sigue activo hasta ${accessUntil?.toISOString() ?? '—'}.`) +
        ` Motivo: ${reason ?? '—'}`,
    );
    return { ok: true, accessUntil, suspendedNow: desconectarYa };
  }

  /**
   * El negocio se reactiva solo, 3 días, para ir a pagar. Lo dice el propio
   * texto del panel: «te reactivamos por 3 días para que completes el pago».
   * Al vencer, el cron de pruebas lo vuelve a pausar.
   *
   * DOS COSAS QUE FALTABAN (2026-09-07, caso Quipao):
   *
   *  · **No se podía repetir y sí se repetía.** No había nada que lo impidiera:
   *    cada vez que la cuenta volvía a pausarse, otro botón y otros 3 días
   *    gratis, sin fin. Ahora solo una vez por ciclo de cobro — hasta que
   *    entre un pago, no hay una segunda.
   *
   *  · **No dejaba rastro.** Ni auditoría ni aviso. Por eso el negocio salía en
   *    «prueba» sin que nadie supiera por qué, y en la auditoría de Quipao no
   *    aparecía nada entre la suspensión de las 03:00 y el cobro de la noche.
   *    Ahora se audita y el equipo recibe un SMS.
   */
  async reactivate(tenantId: string) {
    const t = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: {
        id: true,
        brandName: true,
        status: true,
        suspendedAt: true,
        trialEndsAt: true,
        lastChargeAt: true,
      },
    });
    if (!t) throw new Error('Tenant not found');
    if (t.status !== 'SUSPENDED') {
      throw new Error('La cuenta no está suspendida');
    }

    // ¿Ya usó su ventana en este ciclo? Se mide contra el último cobro: si
    // pagó después de reactivarse, empieza ciclo nuevo y vuelve a tener una.
    const previa = await this.prisma.auditLog.findFirst({
      where: {
        tenantId,
        action: 'subscription.self_reactivated',
        ...(t.lastChargeAt ? { createdAt: { gt: t.lastChargeAt } } : {}),
      },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    });
    if (previa) {
      throw new Error(
        'Ya usaste los días para completar el pago. Para volver a entrar, ' +
          'termina el pago en la pasarela y tu cuenta se activa sola.',
      );
    }

    const bonusDays = 3;
    const newTrialEnd = new Date(Date.now() + bonusDays * 24 * 60 * 60 * 1000);
    await this.prisma.tenant.update({
      where: { id: tenantId },
      data: {
        status: 'TRIAL',
        suspendedAt: null,
        trialEndsAt: newTrialEnd,
      },
    });
    await this.auditLifecycle('subscription.self_reactivated', tenantId, {
      bonusDays,
      suspendedAt: t.suspendedAt?.toISOString() ?? null,
      until: newTrialEnd.toISOString(),
    });
    await this.notifyBillingTeam('autoreactivado', t.brandName, {
      dias: bonusDays,
    }).catch(() => null);
    this.logger.log(`Tenant ${tenantId} reactivated with ${bonusDays} bonus days`);
    return { ok: true, trialEndsAt: newTrialEnd };
  }

  async startTrial(tenantId: string) {
    const now = new Date();
    const ends = new Date(now.getTime() + TRIAL_DAYS * 24 * 60 * 60 * 1000);
    return this.prisma.tenant.update({
      where: { id: tenantId },
      data: {
        status: 'TRIAL',
        trialStartedAt: now,
        trialEndsAt: ends,
        suspendedAt: null,
      },
    });
  }

  async getStatus(tenantId: string): Promise<TrialStatus> {
    const t = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: {
        status: true,
        trialEndsAt: true,
        currentPeriodEnd: true,
        suspendedAt: true,
        canceledAt: true,
        failedPaymentCount: true,
        gracePeriodDays: true,
        // Fase 2: campos del ciclo de renovación para deriveRenewalState.
        firstFailedAt: true,
        lastPaymentAttemptAt: true,
        lastChargeAt: true,
        // Distinguir prueba PAGA (con suscripción) de la GRATIS (sin tarjeta).
        stripeSubscriptionId: true,
      },
    });
    const graceDays = await this.getGraceDays();
    if (!t) {
      return {
        status: 'EXPIRED',
        trialEndsAt: null,
        daysLeftInTrial: null,
        currentPeriodEnd: null,
        isActiveAccess: false,
        gracePeriodDays: 0,
        inGracePeriod: false,
        graceDaysLeft: null,
        paidTrial: false,
        renewal: {
          state: 'CANCELADO',
          byFailure: false,
          daysOverdue: 0,
          graceDays,
          graceDaysLeft: null,
          graceLabel: null,
          nextChargeAt: null,
          pauseDate: null,
        },
        canceledAt: null,
        canceladaHasta: null,
      };
    }

    const now = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;
    // Fase 2: estado del ciclo de renovación (mora de dinero) con la misma regla
    // que suspende. reminder/notice/staleCap coinciden con processOverdueAccounts.
    const renewal = deriveRenewalState(t, new Date(now), {
      graceDays,
      reminderDay: OVERDUE_REMINDER_DAY,
      noticeDay: OVERDUE_NOTICE_DAY,
      staleCapDays: STALE_OVERDUE_CAP_DAYS,
      proximoCobroDays: PROXIMO_COBRO_DAYS,
    });
    let daysLeft: number | null = null;
    // 2026-06-06: solo calculamos el contador de trial si el tenant
    // todavía está en TRIAL. Si ya pagó (status ACTIVE/PAST_DUE/SUSPENDED)
    // el contador no aplica aunque trialEndsAt tenga un valor histórico.
    if (t.status === 'TRIAL' && t.trialEndsAt) {
      daysLeft = Math.max(
        0,
        Math.ceil((t.trialEndsAt.getTime() - now) / dayMs),
      );
    }

    // Ventana de gracia = [trialEndsAt, trialEndsAt + gracePeriodDays).
    const grace = t.gracePeriodDays ?? 0;
    let inGracePeriod = false;
    let graceDaysLeft: number | null = null;
    if (
      t.status === 'TRIAL' &&
      !t.suspendedAt &&
      t.trialEndsAt &&
      t.trialEndsAt.getTime() < now &&
      grace > 0
    ) {
      const graceEnd = t.trialEndsAt.getTime() + grace * dayMs;
      if (graceEnd > now) {
        inGracePeriod = true;
        graceDaysLeft = Math.max(0, Math.ceil((graceEnd - now) / dayMs));
      }
    }

    let derived: TrialStatus['status'] = t.status as any;
    if (t.suspendedAt) derived = 'SUSPENDED';
    else if (
      t.status === 'TRIAL' &&
      t.trialEndsAt &&
      t.trialEndsAt.getTime() < now &&
      !inGracePeriod
    ) {
      derived = 'EXPIRED';
    } else if (t.status === 'ACTIVE' && (t.failedPaymentCount ?? 0) > 0) {
      derived = 'PAST_DUE';
    }

    // Durante la gracia mantenemos acceso (el cron tampoco lo suspende todavía).
    const isActiveAccess =
      derived === 'TRIAL' ||
      derived === 'ACTIVE' ||
      derived === 'PAST_DUE' ||
      inGracePeriod;

    // CANCELADA CON DÍAS POR DELANTE. Solo se informa mientras QUEDE acceso: una
    // vez vencido el período, el negocio ya está suspendido y el aviso correcto
    // es el de la suspensión, no «te queda hasta…» hablando del pasado.
    const canceladaHasta =
      t.canceledAt && isActiveAccess
        ? (t.currentPeriodEnd ?? t.trialEndsAt ?? null)
        : null;

    return {
      status: derived,
      trialEndsAt: t.trialEndsAt,
      daysLeftInTrial: daysLeft,
      currentPeriodEnd: t.currentPeriodEnd,
      isActiveAccess,
      gracePeriodDays: grace,
      inGracePeriod,
      canceledAt: t.canceledAt ?? null,
      canceladaHasta,
      graceDaysLeft,
      // Prueba paga = está en TRIAL Y ya ancló tarjeta (tiene suscripción). El
      // cobro llega solo al día 7; no hay que pedirle "completar el pago".
      paidTrial: derived === 'TRIAL' && !!t.stripeSubscriptionId,
      renewal,
    };
  }

  /**
   * El ciclo de cobro: UNA pasada al día, dentro de la ventana configurada.
   *
   * ANTES: `@Cron(CronExpression.EVERY_DAY_AT_3AM)`. El servidor va en UTC, así
   * que «las 3 de la mañana» eran **las 22:00 de Bogotá**: a los dueños de
   * negocio les llegaban los recordatorios de cobro a las 10 de la noche, y la
   * pasada se estiraba hasta cerca de las 11. Verificado en los envíos reales,
   * no solo en el código. Ver `ventana-de-envio.ts`.
   *
   * AHORA corre cada hora y solo actúa dentro de la ventana, una vez al día.
   *
   * ⚠ AL DESPLEGAR ESTE CAMBIO — LEER. El candado de abajo solo coordina
   * procesos que corran ESTE código; no ve al cron viejo. Si en un mismo día
   * natural corren el viejo (03:00 UTC) y el nuevo (la ventana), los avisos
   * salen DOS veces a todo el mundo. Con la ventana por defecto (9-13 Bogotá =
   * 14:00-18:00 UTC), la franja segura para desplegar es **entre las 18:01 y
   * las 02:50 UTC**: después de que el nuevo ya pasó y antes de que el viejo
   * dispare. Un rollback no duplica, PIERDE el día.
   */
  @Cron('0 * * * *')
  async dailyCron(ahora: Date = new Date()) {
    const ventana = await this.getVentanaDeEnvio();
    const hora = horaLocal(ahora, ventana.zona);
    if (!dentroDeLaVentana(hora, ventana)) return;

    // El día se reclama ANTES de trabajar: si dos procesos coinciden (durante
    // un despliegue Railway mantiene vivo el viejo hasta que el nuevo pasa el
    // healthcheck), solo uno se lo lleva. `count` es lo que lo decide, no una
    // lectura previa — leer y luego escribir es justo la carrera que queremos
    // evitar.
    if (!(await this.reclamarElDia(fechaLocal(ahora, ventana.zona)))) return;

    const r = await this.runDailyCheck();
    if (r.suspendedCount > 0 || r.autoPausedCount > 0 || r.overdueReminderCount > 0) {
      this.logger.log(
        `Daily cron: trial-suspended=${r.suspendedCount} auto-paused=${r.autoPausedCount} reminders-precharge=${r.reminderCount} overdue-reminders=${r.overdueReminderCount} pause-notices=${r.pauseNoticeCount}`,
      );
    }
  }

  /** La ventana configurada, o la de fábrica si no hay nada guardado. */
  async getVentanaDeEnvio(): Promise<VentanaDeEnvio> {
    const row = await this.prisma.setting
      .findUnique({ where: { key: CLAVE_VENTANA } })
      .catch(() => null);
    return leerVentana(row?.value);
  }

  /** Guarda la ventana ya saneada y devuelve lo que quedó guardado. */
  async setVentanaDeEnvio(entrada: unknown): Promise<VentanaDeEnvio> {
    const v = normalizarVentana(entrada);
    const value = JSON.stringify(v);
    await this.prisma.setting.upsert({
      where: { key: CLAVE_VENTANA },
      update: { value },
      create: { key: CLAVE_VENTANA, value },
    });
    return v;
  }

  /**
   * Reclama el día para esta pasada. Devuelve true solo si ES ESTA corrida la
   * que se lo lleva.
   *
   * El candado vive en la BASE y no en memoria porque en memoria no sobrevive
   * a lo que de verdad pasa: durante cada despliegue hay dos procesos con el
   * cron armado, cada uno con su propia memoria, y si el solape cruza un tick
   * de la ventana el ciclo entero sale doble —recordatorios, avisos de mora y
   * de pausa a todos los negocios—.
   *
   * El `upsert` previo es necesario porque `updateMany` no crea filas: sin él,
   * el primer día después de desplegar no correría nunca.
   */
  private async reclamarElDia(diaLocal: string): Promise<boolean> {
    await this.prisma.setting
      .upsert({
        where: { key: CLAVE_ULTIMA_PASADA },
        update: {},
        create: { key: CLAVE_ULTIMA_PASADA, value: '' },
      })
      .catch(() => null);
    const claim = await this.prisma.setting.updateMany({
      where: { key: CLAVE_ULTIMA_PASADA, value: { not: diaLocal } },
      data: { value: diaLocal },
    });
    return claim.count === 1;
  }

  /**
   * Suspende a quien canceló y ya se le acabó el período que pagó.
   *
   * Es la otra mitad de la decisión del 2026-09-10: la cancelación NO corta el
   * servicio en el acto —el cliente pagó hasta una fecha y hasta esa fecha
   * tiene derecho a usarlo— así que alguien tiene que apagarlo cuando llegue.
   * Ese alguien es esto.
   *
   * Sin este método, no suspender al recibir el aviso significaría que un
   * negocio que canceló se queda ACTIVO para siempre. Es exactamente el hueco
   * que abriría hacer solo la mitad del cambio.
   *
   * `updateMany` condicional sobre `status: 'ACTIVE'`: si otro camino ya lo
   * suspendió (mora, reembolso), esto no lo toca ni lo cuenta.
   */
  private async suspendCanceledAtPeriodEnd(now: Date) {
    const vencidos = await this.prisma.tenant.findMany({
      where: {
        status: 'ACTIVE',
        canceledAt: { not: null },
        // Venció lo pagado, o el último cobro falló: en los dos casos no queda
        // nada que respetar. Lo segundo pasa cuando Hotmart avisa del cobro
        // fallido junto a la cancelación (VALMONT BARBERIA, 15-09-2026).
        OR: [{ currentPeriodEnd: { lte: now } }, { failedPaymentCount: { gt: 0 } }],
      },
      select: { id: true, brandName: true, currentPeriodEnd: true },
    });
    let n = 0;
    for (const t of vencidos) {
      const r = await this.prisma.tenant.updateMany({
        where: { id: t.id, status: 'ACTIVE' },
        data: { status: 'SUSPENDED', suspendedAt: now },
      });
      if (r.count === 0) continue;
      n++;
      // El crédito de la marca se libera AQUÍ, que es cuando el negocio deja
      // de ocupar plaza de verdad — no cuando avisó de que se iba.
      await this.releaseBrandCreditOnSuspend(t.id, 'cancelacion_fin_de_periodo').catch(
        () => null,
      );
      await this.auditLifecycle('subscription.suspended', t.id, {
        reason: 'canceled_period_ended',
        periodEnd: t.currentPeriodEnd?.toISOString() ?? null,
      }).catch(() => null);
      this.logger.log(
        `Cancelación vencida: ${t.brandName} suspendido (pagó hasta ${t.currentPeriodEnd?.toISOString().slice(0, 10)}).`,
      );
    }
    return n;
  }

  /** Bloquea tenants con trial expirado (respetando gracePeriodDays) + secuencia SMS. */
  async runDailyCheck() {
    const now = new Date();
    const dayMs = 24 * 60 * 60 * 1000;
    const candidates = await this.prisma.tenant.findMany({
      where: {
        status: 'TRIAL',
        trialEndsAt: { lt: now },
        currentPeriodEnd: null,
      },
      select: {
        id: true,
        brandName: true,
        trialEndsAt: true,
        gracePeriodDays: true,
        manualPayment: true,
      },
    });
    // Solo suspendemos si trialEndsAt + gracePeriodDays ya pasó. La gracia 0
    // mantiene el comportamiento anterior (corte duro al vencer trial).
    const expiredTrials = candidates.filter((t) => {
      if (!t.trialEndsAt) return false;
      const cutoff = t.trialEndsAt.getTime() + (t.gracePeriodDays ?? 0) * dayMs;
      return cutoff < now.getTime();
    });

    let trialSuspendedCount = 0;
    for (const t of expiredTrials) {
      // Gate pago-por-fuera: puede haber pagado en efectivo/Nequi y que el
      // registro del pago venga con días de retraso — suspender a un cliente
      // que sí pagó es peor que dejarle unos días de más a uno que no. Queda
      // visible en la lista de revisión (GET /tenants/manual-payments/review).
      if (t.manualPayment) {
        this.logger.warn(
          `Tenant ${t.brandName} (${t.id}) con trial vencido pero paga POR FUERA (manualPayment) — NO auto-suspendido; aparece en la lista de revisión.`,
        );
        continue;
      }
      await this.prisma.tenant.update({
        where: { id: t.id },
        data: { status: 'SUSPENDED', suspendedAt: now },
      });
      trialSuspendedCount++;
      this.logger.warn(`Tenant ${t.brandName} (${t.id}) suspended: trial expired`);
    }

    // ────── Serie pre-cobro (PDF734): 7 días antes · 1 día antes · mismo día ──────
    const canceladosVencidos = await this.suspendCanceledAtPeriodEnd(now);
    const reminder7dCount = await this.sendPreChargeReminder7d(now);
    const reminder3dCount = await this.sendPreChargeReminder3d(now); // D-3 (PDF 1256)
    const reminderCount = await this.sendPaymentReminders(now); // D-1
    const reminderTodayCount = await this.sendPreChargeReminderToday(now); // día del cobro
    // Secuencia de mora D+1/D+2/D+3 (recordatorio → "no procesado" → suspensión).
    const dunning = await this.processOverdueAccounts(now);
    // Solo deja constancia (no toca datos): fechas de cobro que van por delante
    // del ciclo real y que, calladas, dejan al negocio sin un solo aviso previo.
    const fechasTardias = await this.avisarFechasDeCobroTardias();

    return {
      suspendedCount: trialSuspendedCount,
      fechasTardiasCount: fechasTardias,
      // Los que cancelaron y se les acabó el período que pagaron.
      canceledEndedCount: canceladosVencidos,
      reminderCount:
        reminder7dCount + reminder3dCount + reminderCount + reminderTodayCount,
      overdueReminderCount: dunning.reminders,
      pauseNoticeCount: dunning.notices,
      autoPausedCount: dunning.suspended,
    };
  }

  /**
   * Blindaje anti-desincronización (BUG PDF734 — Quipao Bubble Tea).
   * ¿El ciclo actual ya está pagado aunque los campos de billing hayan
   * quedado desincronizados? Señales:
   *   - lastChargeAt >= currentPeriodEnd → el cobro ya ocurrió en/después de
   *     la fecha registrada como "próximo cobro" → esa fecha quedó vieja.
   *   - currentPeriodEnd está ANTES de un período completo después del último
   *     cobro exitoso → Hotmart cobró pero no avanzó la fecha (margen 2 días
   *     por drift de fechas de la pasarela).
   * En ambos casos el pago YA entró: no hay que recordar ni mandar mora.
   *
   * OJO, es DELIBERADAMENTE ASIMÉTRICO: solo mira el desfase hacia ATRÁS. Una
   * fecha que va por DELANTE del ciclo real no entra acá ni debe entrar — ver
   * `avisarFechasDeCobroTardias`, que explica por qué sanarla haría daño.
   */
  private paidButStale(t: {
    lastChargeAt: Date | null;
    currentPeriodEnd: Date | null;
    planPeriodicity: string | null;
  }): boolean {
    if (!t.lastChargeAt || !t.currentPeriodEnd) return false;
    if (t.lastChargeAt.getTime() >= t.currentPeriodEnd.getTime()) return true;
    const dayMs = 24 * 60 * 60 * 1000;
    const expectedNext = addPlanPeriod(t.lastChargeAt, t.planPeriodicity);
    return t.currentPeriodEnd.getTime() < expectedNext.getTime() - 2 * dayMs;
  }

  /**
   * El caso SIMÉTRICO de `paidButStale`: negocios cuya fecha de cobro apunta
   * DESPUÉS del ciclo real. Solo AVISA; no toca un solo dato. Esa es la
   * decisión importante de este método.
   *
   * Sanarlo por el camino de `paidButStale` habría hecho daño: `healStaleCharge`
   * limpia `failedPaymentCount` y `firstFailedAt`, así que a Café Macondo —que
   * tiene DOS cobros fallidos de verdad— le habría borrado la mora y lo habría
   * dejado figurando al día. Es exactamente el fallo de MYKOZ que documenta
   * `esMoraFantasma` en dunning.ts. Y `nextChargeAfterPayment` tampoco lo
   * arreglaría: parte de `currentPeriodEnd`, que acá es justo el dato malo.
   *
   * Corregir la fecha se decide negocio por negocio (moverla al pasado los
   * vuelve morosos de golpe y el cron los suspendería pagando bien), y para eso
   * está `scripts/corregir-fecha-de-cobro.cjs`. El cron solo deja constancia:
   * sin esto el desfase no aparece en ningún sitio hasta que el cobro ya falló,
   * que es como se descubrió el caso Macondo.
   */
  private async avisarFechasDeCobroTardias() {
    const candidatos = await this.prisma.tenant.findMany({
      where: {
        status: 'ACTIVE',
        canceledAt: null,
        deletedAt: null,
        isCampaignHost: false,
        currentPeriodEnd: { not: null },
        lastChargeAt: { not: null },
        // El mismo universo que los avisos de pre-cobro: Clubify (legacy con
        // whiteLabelId null) + marcas que cobran directo por Stripe.
        OR: [
          { whiteLabelId: null },
          { whiteLabel: { slug: 'clubify' } },
          { whiteLabel: { paymentGateway: 'STRIPE' } },
        ],
      },
      select: {
        id: true,
        brandName: true,
        currentPeriodEnd: true,
        lastChargeAt: true,
        planPeriodicity: true,
      },
    });
    // UNA línea al día, no una por negocio: esto corre a diario y los que
    // quedan sin corregir (Birria León necesita decisión manual) sonarían para
    // siempre. Un resumen se lee; 18 líneas repetidas se aprenden a ignorar.
    const tardias: string[] = [];
    for (const t of candidatos) {
      const dias = diasDeFechaTardia(t);
      if (dias == null) continue;
      tardias.push(`${t.brandName} (+${dias}d)`);
    }
    if (tardias.length) {
      this.logger.warn(
        `[FECHA-DE-COBRO] ${tardias.length} negocio(s) con el cobro apuntado DESPUÉS ` +
          `del ciclo real: los avisos previos saldrían tarde o no saldrían. ` +
          `Corregir con scripts/corregir-fecha-de-cobro.cjs → ${tardias.join(', ')}`,
      );
    }
    return tardias.length;
  }

  /**
   * Auto-sana un ciclo ya pagado con fecha vieja: avanza currentPeriodEnd a
   * (último cobro + período del plan), limpia el contador de fallos y resetea
   * los flags de recordatorio/pausa. Deja el estado consistente para el
   * próximo cron y para el dashboard, y frena los SMS erróneos.
   */
  private async healStaleCharge(
    now: Date,
    t: {
      id: string;
      brandName: string;
      currentPeriodEnd: Date | null;
      lastChargeAt: Date | null;
      planPeriodicity: string | null;
    },
  ) {
    if (!t.lastChargeAt) return;
    const nextCharge = this.nextChargeAfterPayment(now, t);
    await this.prisma.tenant.update({
      where: { id: t.id },
      data: {
        currentPeriodEnd: nextCharge,
        failedPaymentCount: 0,
        // El pago ya estaba recibido → limpiar el ancla de mora del ciclo.
        firstFailedAt: null,
        lastPaymentAttemptAt: t.lastChargeAt,
        paymentReminderSentFor: null,
        pausePendingNoticeSentAt: null,
      },
    });
    this.logger.warn(
      `Billing self-heal ${t.brandName} (${t.id}): pago ya recibido (lastChargeAt=${t.lastChargeAt.toISOString()}) con currentPeriodEnd viejo → avanzado a ${nextCharge.toISOString()}; mora/recordatorios reseteados.`,
    );
  }

  /**
   * Próximo cobro para un ciclo YA pagado con fecha vieja. Preserva el día de
   * cobro original: parte de currentPeriodEnd (o del último pago) y avanza por
   * períodos COMPLETOS hasta que la fecha sea un ciclo real DESPUÉS del último
   * pago (no re-cobra el ciclo recién pagado) y quede en el futuro.
   * Ej. Quipao: pago 04/07, currentPeriodEnd viejo 09/07 (mensual) → 09/08.
   */
  private nextChargeAfterPayment(
    now: Date,
    t: {
      currentPeriodEnd: Date | null;
      lastChargeAt: Date | null;
      planPeriodicity: string | null;
    },
  ): Date {
    const dayMs = 24 * 60 * 60 * 1000;
    const period = t.planPeriodicity;
    const expectedNext = t.lastChargeAt
      ? addPlanPeriod(t.lastChargeAt, period)
      : addPlanPeriod(now, period);
    let next = new Date(t.currentPeriodEnd ?? expectedNext);
    let guard = 0;
    // Un ciclo real después del último pago (mismo umbral que paidButStale).
    while (
      next.getTime() < expectedNext.getTime() - 2 * dayMs &&
      guard++ < 120
    ) {
      next = addPlanPeriod(next, period);
    }
    // Salvaguarda para data legacy muy vieja: empujar al futuro.
    while (next.getTime() <= now.getTime() && guard++ < 240) {
      next = addPlanPeriod(next, period);
    }
    return next;
  }

  /** Nombre de pila del dueño (TENANT_OWNER) para los SMS de tono personal. */
  private async ownerFirstName(tenantId: string): Promise<string> {
    const owner = await this.prisma.user.findFirst({
      where: { tenantId, role: 'TENANT_OWNER', isActive: true },
      select: { fullName: true },
      orderBy: { createdAt: 'asc' },
    });
    const full = (owner?.fullName || '').trim();
    return full ? full.split(/\s+/)[0] : '';
  }

  /**
   * D-7: aviso amable 7 días antes de la renovación (solo Clubify).
   * Idempotencia por ciclo con preReminder7dSentFor === currentPeriodEnd.
   */
  private async sendPreChargeReminder7d(now: Date) {
    const dayMs = 24 * 60 * 60 * 1000;
    const from = new Date(now.getTime() + 7 * dayMs);
    const to = new Date(now.getTime() + 8 * dayMs);
    const candidates = await this.prisma.tenant.findMany({
      where: {
        status: 'ACTIVE',
        // Quien ya canceló NO recibe recordatorios de un cobro que no va a
        // ocurrir. Sigue activo hasta el fin del período que pagó —decisión de
        // Javier, 2026-09-10— pero cobrarle de nuevo no está en el plan, así
        // que recordárselo solo hace ruido y parece que no nos enteramos.
        canceledAt: null,
        isCampaignHost: false,
        // Quien ya está en mora recibe los avisos de mora, no «pronto renovamos».
        // Mezclarlos le contaba a La burguesía que el cobro era «mañana» dos
        // días después de decirle que había fallado (septiembre de 2026).
        failedPaymentCount: 0,
        currentPeriodEnd: { gte: from, lt: to },
        // PDF 1256 §4: los recordatorios de próximo cobro llegan a Clubify +
        // marcas que cobran directo por Stripe (antes solo Clubify).
        OR: [
          { whiteLabelId: null },
          { whiteLabel: { slug: 'clubify' } },
          { whiteLabel: { paymentGateway: 'STRIPE' } },
        ],
      },
      select: {
        id: true,
        brandName: true,
        currentPeriodEnd: true,
        lastChargeAt: true,
        planPeriodicity: true,
        preReminder7dSentFor: true,
      },
    });
    let sent = 0;
    for (const t of candidates) {
      if (!t.currentPeriodEnd) continue;
      if (this.paidButStale(t)) {
        await this.healStaleCharge(now, t);
        continue;
      }
      if (
        t.preReminder7dSentFor &&
        t.preReminder7dSentFor.getTime() === t.currentPeriodEnd.getTime()
      ) {
        continue;
      }
      let notified = false;
      const target = await this.resolveBillingTarget(t.id);
      if (target) {
        const ownerName = await this.ownerFirstName(t.id);
        const message = await this.smsTemplates.render(
          'payment_reminder_7d',
          { ownerName },
          t.id,
        );
        const r = await this.growBusiness.sendSmsWithCreds(
          target.creds,
          target.phone,
          message,
          { tenantId: t.id, templateId: 'payment_reminder_7d', feature: 'billing' },
        );
        if (r.ok) {
          notified = true;
          this.logger.log(`SMS D-7 → ${t.brandName} (${target.phone})`);
        }
      }
      if (
        await this.mailReminder(t, 'email_payment_reminder_7d', 'D-7', {
          chargeDate: fmtEmailDate(t.currentPeriodEnd),
        })
      ) {
        notified = true;
      }
      if (notified) {
        await this.prisma.tenant.update({
          where: { id: t.id },
          data: { preReminder7dSentFor: t.currentPeriodEnd },
        });
        sent++;
      }
    }
    return sent;
  }

  /**
   * ¿Ya se avisó hoy? Los avisos de mora se disparan por `daysOverdue === N`,
   * que es cierto durante todo el día: sin esto, cada corrida extra del cron
   * (o del endpoint manual /billing/run-daily-check) le repite al cliente el
   * mismo correo y el mismo SMS.
   */
  private avisadoHoy(marca: Date | null | undefined, now: Date): boolean {
    if (!marca) return false;
    return marca.toDateString() === now.toDateString();
  }

  /**
   * Correo de un aviso de cobro. Canal INDEPENDIENTE del SMS: sale aunque el
   * negocio no tenga teléfono ni credenciales de SMS. El gate real lo pone
   * BrandEmailService (una marca sin remitente ni cuenta propios no envía).
   * Devuelve true solo si el correo salió de verdad, para que el dedup por
   * ciclo se marque únicamente cuando algún canal llegó.
   */
  private async mailReminder(
    t: { id: string; brandName: string },
    templateId: string,
    tag: string,
    vars: Record<string, string>,
  ): Promise<boolean> {
    const r = await this.brandEmail
      .sendTemplate({ templateId, tenantId: t.id, vars })
      .catch(() => ({ sent: false }));
    if (r.sent) this.logger.log(`Correo ${tag} → ${t.brandName}`);
    return r.sent;
  }

  /** PDF 1256 §4: recordatorio "3 días antes" del próximo cobro. Mismo patrón
   *  que el de 7 días. Clubify + marcas Stripe. */
  private async sendPreChargeReminder3d(now: Date) {
    const dayMs = 24 * 60 * 60 * 1000;
    const from = new Date(now.getTime() + 3 * dayMs);
    const to = new Date(now.getTime() + 4 * dayMs);
    const candidates = await this.prisma.tenant.findMany({
      where: {
        status: 'ACTIVE',
        // Quien ya canceló NO recibe recordatorios de un cobro que no va a
        // ocurrir. Sigue activo hasta el fin del período que pagó —decisión de
        // Javier, 2026-09-10— pero cobrarle de nuevo no está en el plan, así
        // que recordárselo solo hace ruido y parece que no nos enteramos.
        canceledAt: null,
        isCampaignHost: false,
        // Quien ya está en mora recibe los avisos de mora, no «pronto renovamos».
        // Mezclarlos le contaba a La burguesía que el cobro era «mañana» dos
        // días después de decirle que había fallado (septiembre de 2026).
        failedPaymentCount: 0,
        currentPeriodEnd: { gte: from, lt: to },
        OR: [
          { whiteLabelId: null },
          { whiteLabel: { slug: 'clubify' } },
          { whiteLabel: { paymentGateway: 'STRIPE' } },
        ],
      },
      select: {
        id: true,
        brandName: true,
        currentPeriodEnd: true,
        lastChargeAt: true,
        planPeriodicity: true,
        preReminder3dSentFor: true,
      },
    });
    let sent = 0;
    for (const t of candidates) {
      if (!t.currentPeriodEnd) continue;
      if (this.paidButStale(t)) {
        await this.healStaleCharge(now, t);
        continue;
      }
      if (
        t.preReminder3dSentFor &&
        t.preReminder3dSentFor.getTime() === t.currentPeriodEnd.getTime()
      ) {
        continue;
      }
      let notified = false;
      const target = await this.resolveBillingTarget(t.id);
      if (target) {
        const ownerName = await this.ownerFirstName(t.id);
        const message = await this.smsTemplates.render(
          'payment_reminder_3d',
          { ownerName },
          t.id,
        );
        const r = await this.growBusiness.sendSmsWithCreds(
          target.creds,
          target.phone,
          message,
          { tenantId: t.id, templateId: 'payment_reminder_3d', feature: 'billing' },
        );
        if (r.ok) {
          notified = true;
          this.logger.log(`SMS D-3 → ${t.brandName} (${target.phone})`);
        }
      }
      if (
        await this.mailReminder(t, 'email_payment_reminder_3d', 'D-3', {
          chargeDate: fmtEmailDate(t.currentPeriodEnd),
        })
      ) {
        notified = true;
      }
      if (notified) {
        await this.prisma.tenant.update({
          where: { id: t.id },
          data: { preReminder3dSentFor: t.currentPeriodEnd },
        });
        sent++;
      }
    }
    return sent;
  }

  /**
   * D-0: aviso el mismo día en que se procesa la renovación (solo Clubify).
   * Idempotencia por ciclo con preReminderTodaySentFor === currentPeriodEnd.
   */
  private async sendPreChargeReminderToday(now: Date) {
    const dayMs = 24 * 60 * 60 * 1000;
    // La ventana arranca a las 00:00 de HOY, no en `now`. El cron corre a las
    // 3AM: con `gte: now` un negocio cuyo cobro cae entre las 00:00 y las 03:00
    // quedaba fuera y nunca recibía el aviso de "hoy renovamos" — pasaba
    // directo a la vía de mora al día siguiente.
    const desde = new Date(now);
    desde.setHours(0, 0, 0, 0);
    const to = new Date(desde.getTime() + dayMs);
    const candidates = await this.prisma.tenant.findMany({
      where: {
        status: 'ACTIVE',
        // Quien ya canceló NO recibe recordatorios de un cobro que no va a
        // ocurrir. Sigue activo hasta el fin del período que pagó —decisión de
        // Javier, 2026-09-10— pero cobrarle de nuevo no está en el plan, así
        // que recordárselo solo hace ruido y parece que no nos enteramos.
        canceledAt: null,
        isCampaignHost: false,
        // Quien ya está en mora recibe los avisos de mora, no «pronto renovamos».
        // Mezclarlos le contaba a La burguesía que el cobro era «mañana» dos
        // días después de decirle que había fallado (septiembre de 2026).
        failedPaymentCount: 0,
        currentPeriodEnd: { gte: desde, lt: to },
        // PDF 1256 §4: los recordatorios de próximo cobro llegan a Clubify +
        // marcas que cobran directo por Stripe (antes solo Clubify).
        OR: [
          { whiteLabelId: null },
          { whiteLabel: { slug: 'clubify' } },
          { whiteLabel: { paymentGateway: 'STRIPE' } },
        ],
      },
      select: {
        id: true,
        brandName: true,
        currentPeriodEnd: true,
        lastChargeAt: true,
        planPeriodicity: true,
        preReminderTodaySentFor: true,
      },
    });
    let sent = 0;
    for (const t of candidates) {
      if (!t.currentPeriodEnd) continue;
      if (this.paidButStale(t)) {
        await this.healStaleCharge(now, t);
        continue;
      }
      if (
        t.preReminderTodaySentFor &&
        t.preReminderTodaySentFor.getTime() === t.currentPeriodEnd.getTime()
      ) {
        continue;
      }
      let notified = false;
      const target = await this.resolveBillingTarget(t.id);
      if (target) {
        const ownerName = await this.ownerFirstName(t.id);
        const message = await this.smsTemplates.render(
          'payment_due_today',
          { ownerName },
          t.id,
        );
        const r = await this.growBusiness.sendSmsWithCreds(
          target.creds,
          target.phone,
          message,
          { tenantId: t.id, templateId: 'payment_due_today', feature: 'billing' },
        );
        if (r.ok) {
          notified = true;
          this.logger.log(
            `SMS día-de-cobro → ${t.brandName} (${target.phone})`,
          );
        }
      }
      if (
        await this.mailReminder(t, 'email_payment_due_today', 'D-0', {
          chargeDate: fmtEmailDate(t.currentPeriodEnd),
        })
      ) {
        notified = true;
      }
      if (notified) {
        await this.prisma.tenant.update({
          where: { id: t.id },
          data: { preReminderTodaySentFor: t.currentPeriodEnd },
        });
        sent++;
      }
    }
    return sent;
  }

  /**
   * D-1: tenants ACTIVE con currentPeriodEnd entre [now+24h, now+48h] que
   * no hayan recibido SMS de recordatorio para este ciclo.
   */
  private async sendPaymentReminders(now: Date) {
    const inOneDay = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const inTwoDays = new Date(now.getTime() + 48 * 60 * 60 * 1000);
    const candidates = await this.prisma.tenant.findMany({
      where: {
        status: 'ACTIVE',
        // Quien ya canceló NO recibe recordatorios de un cobro que no va a
        // ocurrir. Sigue activo hasta el fin del período que pagó —decisión de
        // Javier, 2026-09-10— pero cobrarle de nuevo no está en el plan, así
        // que recordárselo solo hace ruido y parece que no nos enteramos.
        canceledAt: null,
        isCampaignHost: false,
        // Quien ya está en mora recibe los avisos de mora, no «pronto renovamos».
        // Mezclarlos le contaba a La burguesía que el cobro era «mañana» dos
        // días después de decirle que había fallado (septiembre de 2026).
        failedPaymentCount: 0,
        currentPeriodEnd: { gte: inOneDay, lt: inTwoDays },
        // El recordatorio "revisa tu tarjeta en Hotmart" solo aplica a
        // negocios que pagan DIRECTO a la pasarela (Clubify). Las marcas
        // blancas se renuevan con créditos (cron de renovaciones) → no hay
        // cobro Hotmart que recordar, así que las excluimos. Legacy con
        // whiteLabelId null = Clubify.
        // PDF 1256 §4: los recordatorios de próximo cobro llegan a Clubify +
        // marcas que cobran directo por Stripe (antes solo Clubify).
        OR: [
          { whiteLabelId: null },
          { whiteLabel: { slug: 'clubify' } },
          { whiteLabel: { paymentGateway: 'STRIPE' } },
        ],
      },
      select: {
        id: true,
        brandName: true,
        currentPeriodEnd: true,
        lastChargeAt: true,
        planPeriodicity: true,
        paymentReminderSentFor: true,
      },
    });

    let sent = 0;
    for (const t of candidates) {
      if (!t.currentPeriodEnd) continue;
      // Blindaje anti-desincronización (PDF734): si el ciclo ya está pagado
      // (Hotmart cobró pero la fecha quedó vieja), sanamos y no recordamos.
      if (this.paidButStale(t)) {
        await this.healStaleCharge(now, t);
        continue;
      }
      if (
        t.paymentReminderSentFor &&
        t.paymentReminderSentFor.getTime() === t.currentPeriodEnd.getTime()
      ) {
        continue; // ya enviado para este ciclo
      }
      let notified = false;
      const target = await this.resolveBillingTarget(t.id);
      if (target) {
        const ownerName = await this.ownerFirstName(t.id);
        const message = await this.smsTemplates.render('payment_reminder_tomorrow', {
          ownerName,
          brandName: t.brandName,
          chargeDate: fmtSmsDate(t.currentPeriodEnd),
        }, t.id);
        const r = await this.growBusiness.sendSmsWithCreds(
          target.creds,
          target.phone,
          message,
          { tenantId: t.id, templateId: 'payment_reminder_tomorrow', feature: 'billing' },
        );
        if (r.ok) {
          notified = true;
          this.logger.log(`SMS D-1 enviado a ${t.brandName} (${target.phone})`);
        } else {
          this.logger.warn(
            `SMS D-1 falló para ${t.brandName}: ${r.message ?? 'unknown'}`,
          );
        }
      }
      if (
        await this.mailReminder(t, 'email_payment_reminder_tomorrow', 'D-1', {
          chargeDate: fmtEmailDate(t.currentPeriodEnd),
        })
      ) {
        notified = true;
      }
      if (notified) {
        await this.prisma.tenant.update({
          where: { id: t.id },
          data: { paymentReminderSentFor: t.currentPeriodEnd },
        });
        sent++;
      }
    }
    return sent;
  }

  /**
   * Secuencia de mora D+1/D+2/D+3 (P4 PDF 2026-07-01). Corre a diario.
   * Un negocio está en mora si:
   *   (a) tiene cobros fallidos (failedPaymentCount>0) — señal de Hotmart, o
   *   (b) su fecha de cobro programada (currentPeriodEnd) ya pasó sin un pago
   *       nuevo que la renueve. Este chequeo (b) NO depende de recibir el
   *       webhook de falla de Hotmart — era la causa raíz del caso que quedó
   *       4 días sin pausar (Hotmart no envió el evento de cobro fallido).
   * dueSince = inicio de la mora; daysOverdue en días CALENDARIO:
   *   D+1 → recordatorio · D+2 → aviso "mañana se pausa" · D+3 → suspender.
   * Solo negocios Clubify/Hotmart; las marcas blancas se renuevan con créditos
   * (cron de renovaciones) y tienen su propia suspensión.
   */
  private async processOverdueAccounts(now: Date) {
    const candidates = await this.prisma.tenant.findMany({
      where: {
        status: 'ACTIVE',
        // Quien ya canceló NO recibe recordatorios de un cobro que no va a
        // ocurrir. Sigue activo hasta el fin del período que pagó —decisión de
        // Javier, 2026-09-10— pero cobrarle de nuevo no está en el plan, así
        // que recordárselo solo hace ruido y parece que no nos enteramos.
        canceledAt: null,
        isCampaignHost: false,
        AND: [
          {
            // PDF 1256 §4: los recordatorios de próximo cobro llegan a Clubify +
        // marcas que cobran directo por Stripe (antes solo Clubify).
        OR: [
          { whiteLabelId: null },
          { whiteLabel: { slug: 'clubify' } },
          { whiteLabel: { paymentGateway: 'STRIPE' } },
        ],
          },
          {
            OR: [
              { failedPaymentCount: { gt: 0 } },
              { currentPeriodEnd: { lt: now } },
            ],
          },
        ],
      },
      select: {
        id: true,
        brandName: true,
        failedPaymentCount: true,
        firstFailedAt: true,
        lastPaymentAttemptAt: true,
        currentPeriodEnd: true,
        lastChargeAt: true,
        planPeriodicity: true,
        paymentFailureNoticeSentAt: true,
        pausePendingNoticeSentAt: true,
        graceNoticeSentAt: true,
        manualPayment: true,
      },
    });

    let reminders = 0;
    let notices = 0;
    let suspended = 0;
    // PDF 1256 §2: días de gracia antes de pausar, configurables desde el panel
    // (Setting billing.graceDays). Default = PAUSE_DAYS (3).
    const graceDays = await this.getGraceDays();

    for (const t of candidates) {
      // Blindaje anti-desincronización (PDF734): si el pago ya entró pero la
      // fecha/contador quedaron viejos, sanamos y NO mandamos mora. Esto
      // distingue "pagó pero la fecha no avanzó" (skip) de "mora real" (dun).
      if (this.paidButStale(t)) {
        await this.healStaleCharge(now, t);
        continue;
      }
      // FIX PDF123 (mora fantasma a suscriptor activo): un `failedPaymentCount`
      // viejo (desincronización) con el ciclo AÚN vigente (currentPeriodEnd en el
      // futuro) NO es mora — la cuenta está al día. Antes la vía "byFailure"
      // dunneaba igual y le mandaba "pago pendiente / cobro mañana" a quien ya
      // pagó (Quipao). Limpiamos el contador stale y saltamos.
      // La regla vive en `dunning.ts` (`esMoraFantasma`) y ya NO es «ciclo
      // vigente = fantasma»: eso le borró a MYKOZ un PURCHASE_DELAYED real y lo
      // dejó sin un solo aviso durante semanas. Lo que distingue el fantasma es
      // haber PAGADO DESPUÉS del fallo.
      if (esMoraFantasma(t, now)) {
        await this.prisma.tenant.update({
          where: { id: t.id },
          data: { failedPaymentCount: 0, firstFailedAt: null },
        });
        continue;
      }
      // Regla ÚNICA de mora (pura y testeable): billing/dunning.ts. Misma regla
      // para Hotmart, Stripe y pago por fuera — cambia el ancla, no la regla.
      const { dueSince, byFailure, daysOverdue, action } = decideDunning(t, now, {
        graceDays,
        reminderDay: OVERDUE_REMINDER_DAY,
        noticeDay: OVERDUE_NOTICE_DAY,
        staleCapDays: STALE_OVERDUE_CAP_DAYS,
      });
      if (action === 'none' || !dueSince) continue;

      // Tope de seguridad legacy: fecha vencida MUY vieja (currentPeriodEnd que
      // nunca avanzó) — no la auto-suspendemos para no pausar en masa al
      // desplegar. Solo aplica a la vía "fecha vencida", no a cobro fallido.
      if (action === 'stale-skip') {
        this.logger.warn(
          `Tenant ${t.brandName} (${t.id}) vencido hace ${daysOverdue}d por fecha (posible data legacy) — NO auto-pausado. Revisar manual.`,
        );
        continue;
      }

      // El día en que se suspenderá = día (graceDays + 1); la gracia cubre 1..N.
      const pauseDate = pauseDateFor(dueSince, graceDays, byFailure);

      if (action === 'suspend') {
        // 2026-08-31 (decisión del dueño): el pago POR FUERA (manualPayment) YA
        // NO se exime — 5 días de gracia y suspensión al día 6, igual que
        // Hotmart. Su ancla es la FECHA de vencimiento (currentPeriodEnd =
        // último ManualPayment + periodicidad). Sigue en /manual-payments/review.
        await this.prisma.tenant.update({
          where: { id: t.id },
          data: { status: 'SUSPENDED', suspendedAt: now },
        });
        suspended++;
        // Fase 3: alerta interna al equipo (los 3 números).
        await this.notifyBillingTeam('suspendido', t.brandName).catch(() => null);
        // §8 auditoría + §2 liberar crédito a la marca (no-op para Clubify).
        await this.auditLifecycle('subscription.suspended', t.id, {
          reason: byFailure ? 'payment_failed' : 'overdue',
          daysOverdue,
        });
        await this.releaseBrandCreditOnSuspend(t.id, 'dunning').catch(() => null);
        // Correo "cuenta pausada" — independiente del SMS.
        this.brandEmail
          .sendTemplate({ templateId: 'email_account_paused', tenantId: t.id })
          .catch(() => null);
        const target = await this.resolveBillingTarget(t.id);
        if (target) {
          const message = await this.smsTemplates.render('account_paused', {
            brandName: t.brandName,
          }, t.id);
          this.growBusiness
            .sendSmsWithCreds(target.creds, target.phone, message, {
              tenantId: t.id,
              templateId: 'account_paused',
              feature: 'billing',
            })
            .catch((e) =>
              this.logger.warn(
                `SMS "pausada" falló para ${t.brandName}: ${e?.message ?? e}`,
              ),
            );
        }
        this.logger.warn(
          `Tenant ${t.brandName} (${t.id}) auto-pausado: pago no resuelto en ${daysOverdue} día(s)` +
            `${byFailure ? ' (cobro fallido)' : ' (fecha vencida)'}.`,
        );
      } else if (action === 'notice') {
        // Ya se avisó hoy: no repetimos el aviso al cliente.
        if (this.avisadoHoy(t.pausePendingNoticeSentAt, now)) continue;
        await this.prisma.tenant.update({
          where: { id: t.id },
          data: { pausePendingNoticeSentAt: now },
        });
        // Correo "tu cuenta está por pausarse" — independiente del SMS.
        this.brandEmail
          .sendTemplate({
            templateId: 'email_account_will_pause',
            tenantId: t.id,
          })
          .catch(() => null);
        const target = await this.resolveBillingTarget(t.id);
        if (!target) continue;
        // PDF734: D+2 usa el mensaje personal "pago no procesado" (antes era
        // el aviso corto account_will_pause).
        const ownerName = await this.ownerFirstName(t.id);
        const message = await this.smsTemplates.render(
          'payment_not_processed_2d',
          { ownerName },
          t.id,
        );
        const r = await this.growBusiness.sendSmsWithCreds(
          target.creds,
          target.phone,
          message,
          { tenantId: t.id, templateId: 'payment_not_processed_2d', feature: 'billing' },
        );
        if (r.ok) {
          notices++;
          this.logger.log(`SMS D+2 "no procesado" → ${t.brandName}`);
        }
      } else if (action === 'grace' || action === 'last-call') {
        // Los dias 3, 4 y el ultimo de la gracia.
        //
        // Antes eran silencio: el negocio pasaba del «no se pudo procesar» del
        // dia 2 directamente a encontrarse la cuenta pausada, sin nada en
        // medio. Justo los dias en los que todavia puede recargar la tarjeta y
        // arreglarlo, no le deciamos nada.
        //
        // Una sola marca para los tres: lo unico que hay que saber es si ya se
        // aviso HOY.
        if (this.avisadoHoy(t.graceNoticeSentAt, now)) continue;
        await this.prisma.tenant.update({
          where: { id: t.id },
          data: { graceNoticeSentAt: now },
        });
        // El correo va SIEMPRE, aunque no haya telefono o el SMS falle. Es el
        // canal de respaldo: el SMS a segun que paises no llega —el caso de
        // Jean, con numero venezolano— y quedarse sin avisar por eso seria
        // suspenderle la cuenta a alguien que nunca supo que debia pagar.
        this.brandEmail
          .sendTemplate({
            templateId:
              action === 'last-call'
                ? 'email_payment_pause_tomorrow'
                : 'email_payment_overdue_grace',
            tenantId: t.id,
            vars: { pauseDate: fmtEmailDate(pauseDate) },
          })
          .catch(() => null);
        const target = await this.resolveBillingTarget(t.id);
        if (!target) continue;
        const ownerName = await this.ownerFirstName(t.id);
        // El ultimo dia lleva mensaje propio: «manana se pausa» es lo que de
        // verdad hace reaccionar, y decirlo el dia 3 seria mentira.
        const plantilla =
          action === 'last-call'
            ? 'payment_pause_tomorrow'
            : 'payment_overdue_grace';
        const message = await this.smsTemplates.render(
          plantilla,
          { ownerName, pauseDate: fmtSmsDate(pauseDate) },
          t.id,
        );
        const r = await this.growBusiness.sendSmsWithCreds(
          target.creds,
          target.phone,
          message,
          { tenantId: t.id, templateId: plantilla, feature: 'billing' },
        );
        if (r.ok) {
          notices++;
          this.logger.log(
            `SMS D+${daysOverdue} ${action === 'last-call' ? '"manana se pausa"' : 'gracia'} -> ${t.brandName}`,
          );
        }
      } else if (action === 'reminder') {
        // Ya se avisó hoy: no repetimos el aviso al cliente.
        if (this.avisadoHoy(t.paymentFailureNoticeSentAt, now)) continue;
        await this.prisma.tenant.update({
          where: { id: t.id },
          data: { paymentFailureNoticeSentAt: now },
        });
        // Correo "pago vencido" — independiente del SMS.
        this.brandEmail
          .sendTemplate({
            templateId: 'email_payment_overdue',
            tenantId: t.id,
            vars: { pauseDate: fmtEmailDate(pauseDate) },
          })
          .catch(() => null);
        const target = await this.resolveBillingTarget(t.id);
        if (!target) continue;
        const message = await this.smsTemplates.render(
          'payment_overdue_reminder',
          { brandName: t.brandName, pauseDate: fmtSmsDate(pauseDate) },
          t.id,
        );
        const r = await this.growBusiness.sendSmsWithCreds(
          target.creds,
          target.phone,
          message,
          { tenantId: t.id, templateId: 'payment_overdue_reminder', feature: 'billing' },
        );
        if (r.ok) {
          reminders++;
          this.logger.log(`SMS D+1 recordatorio → ${t.brandName}`);
        }
      }
    }

    return { reminders, notices, suspended };
  }
}
