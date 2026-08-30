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

// Secuencia de mora (PDF 2026-07-01, P4). Día 0 = 1er cobro fallido o fecha
// de cobro vencida (lo que ocurra). El cron diario cuenta días calendario:
//   D+1 → recordatorio · D+2 → último aviso "mañana se pausa" · D+3 → suspender.
const OVERDUE_REMINDER_DAY = 1;  // D+1 recordatorio
const OVERDUE_NOTICE_DAY = 2;    // D+2 aviso de pausa
const PAUSE_DAYS = 3;            // D+3 → suspender
// Más allá de este umbral asumimos data legacy (currentPeriodEnd viejo que
// nunca avanzó) y NO auto-suspendemos por la vía de "fecha vencida", para no
// pausar en masa cuentas antiguas al desplegar. La vía de cobro fallido
// (failedPaymentCount>0) no tiene este tope: es señal explícita de Hotmart.
const STALE_OVERDUE_CAP_DAYS = 60;

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
  ) {}

  // ── PDF 1256 §2/§8: gracia configurable, liberación de crédito, auditoría ──

  /** Días de gracia (D+N) antes de suspender por mora. Configurable desde el
   *  panel (Setting `billing.graceDays`). Default 3. Rango 1..30. */
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
    // (mismo valor que se cobró al activar/renovar: InfoLink mensual = 0.25).
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
    if (owner?.phone) return owner.phone;
    const t = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { whatsappPhone: true, phone: true },
    });
    return t?.whatsappPhone ?? t?.phone ?? null;
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

  async cancelSubscription(tenantId: string, reason?: string) {
    const t = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true, status: true, trialEndsAt: true, currentPeriodEnd: true },
    });
    if (!t) throw new Error('Tenant not found');

    await this.prisma.tenant.update({
      where: { id: tenantId },
      data: {
        status: 'SUSPENDED',
        suspendedAt: new Date(),
      },
    });
    this.logger.log(`Tenant ${tenantId} canceled subscription. Reason: ${reason ?? '—'}`);
    return { ok: true, accessUntil: t.currentPeriodEnd ?? t.trialEndsAt };
  }

  async reactivate(tenantId: string) {
    const t = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true, status: true, suspendedAt: true, trialEndsAt: true },
    });
    if (!t) throw new Error('Tenant not found');
    if (t.status !== 'SUSPENDED') {
      throw new Error('La cuenta no está suspendida');
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
        failedPaymentCount: true,
        gracePeriodDays: true,
      },
    });
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
      };
    }

    const now = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;
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

    return {
      status: derived,
      trialEndsAt: t.trialEndsAt,
      daysLeftInTrial: daysLeft,
      currentPeriodEnd: t.currentPeriodEnd,
      isActiveAccess,
      gracePeriodDays: grace,
      inGracePeriod,
      graceDaysLeft,
    };
  }

  /** Corre todos los días a las 03:00 AM (zona del server). */
  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async dailyCron() {
    const r = await this.runDailyCheck();
    if (r.suspendedCount > 0 || r.autoPausedCount > 0 || r.overdueReminderCount > 0) {
      this.logger.log(
        `Daily cron: trial-suspended=${r.suspendedCount} auto-paused=${r.autoPausedCount} reminders-precharge=${r.reminderCount} overdue-reminders=${r.overdueReminderCount} pause-notices=${r.pauseNoticeCount}`,
      );
    }
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
    const reminder7dCount = await this.sendPreChargeReminder7d(now);
    const reminder3dCount = await this.sendPreChargeReminder3d(now); // D-3 (PDF 1256)
    const reminderCount = await this.sendPaymentReminders(now); // D-1
    const reminderTodayCount = await this.sendPreChargeReminderToday(now); // día del cobro
    // Secuencia de mora D+1/D+2/D+3 (recordatorio → "no procesado" → suspensión).
    const dunning = await this.processOverdueAccounts(now);

    return {
      suspendedCount: trialSuspendedCount,
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
        isCampaignHost: false,
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
        isCampaignHost: false,
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
        isCampaignHost: false,
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
        isCampaignHost: false,
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
    const dayMs = 24 * 60 * 60 * 1000;
    const candidates = await this.prisma.tenant.findMany({
      where: {
        status: 'ACTIVE',
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
        lastPaymentAttemptAt: true,
        currentPeriodEnd: true,
        lastChargeAt: true,
        planPeriodicity: true,
        paymentFailureNoticeSentAt: true,
        pausePendingNoticeSentAt: true,
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
      if (
        (t.failedPaymentCount ?? 0) > 0 &&
        t.currentPeriodEnd &&
        t.currentPeriodEnd.getTime() > now.getTime()
      ) {
        await this.prisma.tenant.update({
          where: { id: t.id },
          data: { failedPaymentCount: 0 },
        });
        continue;
      }
      // Inicio de la mora (día 0).
      let dueSince: Date | null = null;
      let byFailure = false;
      if ((t.failedPaymentCount ?? 0) > 0 && t.lastPaymentAttemptAt) {
        dueSince = t.lastPaymentAttemptAt;
        byFailure = true;
      } else if (
        t.currentPeriodEnd &&
        t.currentPeriodEnd.getTime() < now.getTime()
      ) {
        // Fecha de cobro vencida y NO renovada (sin pago posterior al ciclo).
        const renewed =
          t.lastChargeAt != null &&
          t.lastChargeAt.getTime() >= t.currentPeriodEnd.getTime();
        if (!renewed) dueSince = t.currentPeriodEnd;
      }
      if (!dueSince) continue;

      const daysOverdue = Math.floor(
        (now.getTime() - dueSince.getTime()) / dayMs,
      );
      if (daysOverdue < OVERDUE_REMINDER_DAY) continue;

      const pauseDate = new Date(dueSince.getTime() + graceDays * dayMs);

      if (daysOverdue >= graceDays) {
        // Gate pago-por-fuera (manualPayment): este negocio paga por Nequi/
        // efectivo/transferencia y NINGUNA pasarela va a confirmar su pago.
        // Suspender a un cliente que sí pagó en efectivo es peor que dejarle
        // unos días de más a uno que no — así que NO se auto-suspende. Los
        // recordatorios D+1/D+2 sí le siguen llegando (ramas de abajo), y el
        // negocio aparece en GET /tenants/manual-payments/review para que un
        // humano lo persiga o lo desconecte a mano.
        if (t.manualPayment) {
          this.logger.warn(
            `Tenant ${t.brandName} (${t.id}) en mora ${daysOverdue}d pero paga POR FUERA (manualPayment) — NO auto-pausado; revisar en la lista de cobranza manual.`,
          );
          continue;
        }
        // Tope de seguridad SOLO para la vía "fecha vencida" (no la de falla
        // explícita de Hotmart): evita pausar en masa cuentas legacy con
        // currentPeriodEnd viejo que nunca avanzó.
        if (!byFailure && daysOverdue > STALE_OVERDUE_CAP_DAYS) {
          this.logger.warn(
            `Tenant ${t.brandName} (${t.id}) vencido hace ${daysOverdue}d por fecha (posible data legacy) — NO auto-pausado. Revisar manual.`,
          );
          continue;
        }
        await this.prisma.tenant.update({
          where: { id: t.id },
          data: { status: 'SUSPENDED', suspendedAt: now },
        });
        suspended++;
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
      } else if (daysOverdue === OVERDUE_NOTICE_DAY) {
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
      } else if (daysOverdue === OVERDUE_REMINDER_DAY) {
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
