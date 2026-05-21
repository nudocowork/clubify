import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../common/prisma/prisma.service';
import { GrowBusinessService } from '../integrations/grow-business.service';
import {
  smsPaymentReminderTomorrow,
  smsAccountWillPause,
  smsAccountPaused,
} from './billing-sms-templates';

const PAUSE_NOTICE_DAYS = 2;     // D+2 desde último intento fallido → aviso
const PAUSE_DAYS = 4;            // D+4 → suspender

export type TrialStatus = {
  status: 'TRIAL' | 'ACTIVE' | 'PAST_DUE' | 'SUSPENDED' | 'EXPIRED' | 'CANCELED';
  trialEndsAt: Date | null;
  daysLeftInTrial: number | null;
  currentPeriodEnd: Date | null;
  isActiveAccess: boolean;
};

const TRIAL_DAYS = 10;

@Injectable()
export class BillingService {
  private logger = new Logger(BillingService.name);

  constructor(
    private prisma: PrismaService,
    private growBusiness: GrowBusinessService,
  ) {}

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
      },
    });
    if (!t) {
      return {
        status: 'EXPIRED',
        trialEndsAt: null,
        daysLeftInTrial: null,
        currentPeriodEnd: null,
        isActiveAccess: false,
      };
    }

    const now = Date.now();
    let daysLeft: number | null = null;
    if (t.trialEndsAt) {
      daysLeft = Math.max(
        0,
        Math.ceil((t.trialEndsAt.getTime() - now) / (24 * 60 * 60 * 1000)),
      );
    }

    let derived: TrialStatus['status'] = t.status as any;
    if (t.suspendedAt) derived = 'SUSPENDED';
    else if (t.status === 'TRIAL' && t.trialEndsAt && t.trialEndsAt.getTime() < now) {
      derived = 'EXPIRED';
    } else if (t.status === 'ACTIVE' && (t.failedPaymentCount ?? 0) > 0) {
      derived = 'PAST_DUE';
    }

    const isActiveAccess =
      derived === 'TRIAL' || derived === 'ACTIVE' || derived === 'PAST_DUE';

    return {
      status: derived,
      trialEndsAt: t.trialEndsAt,
      daysLeftInTrial: daysLeft,
      currentPeriodEnd: t.currentPeriodEnd,
      isActiveAccess,
    };
  }

  /** Corre todos los días a las 03:00 AM (zona del server). */
  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async dailyCron() {
    const r = await this.runDailyCheck();
    if (r.suspendedCount > 0 || r.autoPausedCount > 0) {
      this.logger.log(
        `Daily cron: trial-suspended=${r.suspendedCount} auto-paused=${r.autoPausedCount} reminders=${r.reminderCount} pause-notices=${r.pauseNoticeCount}`,
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
      select: { id: true, brandName: true, trialEndsAt: true, gracePeriodDays: true },
    });
    // Solo suspendemos si trialEndsAt + gracePeriodDays ya pasó. La gracia 0
    // mantiene el comportamiento anterior (corte duro al vencer trial).
    const expiredTrials = candidates.filter((t) => {
      if (!t.trialEndsAt) return false;
      const cutoff = t.trialEndsAt.getTime() + (t.gracePeriodDays ?? 0) * dayMs;
      return cutoff < now.getTime();
    });

    for (const t of expiredTrials) {
      await this.prisma.tenant.update({
        where: { id: t.id },
        data: { status: 'SUSPENDED', suspendedAt: now },
      });
      this.logger.warn(`Tenant ${t.brandName} (${t.id}) suspended: trial expired`);
    }

    // ────────── Secuencia SMS de notificaciones de cobro Hotmart ──────────
    const reminderCount = await this.sendPaymentReminders(now);
    const pauseNoticeCount = await this.sendPausePendingNotices(now);
    const autoPausedCount = await this.suspendOverdueAccounts(now);

    return {
      suspendedCount: expiredTrials.length,
      reminderCount,
      pauseNoticeCount,
      autoPausedCount,
    };
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
        currentPeriodEnd: { gte: inOneDay, lt: inTwoDays },
      },
      select: {
        id: true,
        brandName: true,
        currentPeriodEnd: true,
        paymentReminderSentFor: true,
      },
    });

    let sent = 0;
    for (const t of candidates) {
      if (
        t.paymentReminderSentFor &&
        t.currentPeriodEnd &&
        t.paymentReminderSentFor.getTime() === t.currentPeriodEnd.getTime()
      ) {
        continue; // ya enviado para este ciclo
      }
      const phone = await this.ownerPhone(t.id);
      if (!phone || !t.currentPeriodEnd) continue;
      const message = smsPaymentReminderTomorrow({
        brandName: t.brandName,
        chargeDate: t.currentPeriodEnd,
      });
      const r = await this.growBusiness.sendSms(t.id, phone, message);
      if (r.ok) {
        await this.prisma.tenant.update({
          where: { id: t.id },
          data: { paymentReminderSentFor: t.currentPeriodEnd },
        });
        sent++;
        this.logger.log(`SMS D-1 enviado a ${t.brandName} (${phone})`);
      } else {
        this.logger.warn(
          `SMS D-1 falló para ${t.brandName}: ${r.message ?? 'unknown'}`,
        );
      }
    }
    return sent;
  }

  /**
   * D+2 desde último intento fallido: SMS "tu cuenta se pausará en 2 días".
   */
  private async sendPausePendingNotices(now: Date) {
    const cutoff = new Date(
      now.getTime() - PAUSE_NOTICE_DAYS * 24 * 60 * 60 * 1000,
    );
    const candidates = await this.prisma.tenant.findMany({
      where: {
        status: 'ACTIVE',
        failedPaymentCount: { gt: 0 },
        lastPaymentAttemptAt: { lt: cutoff },
        OR: [
          { pausePendingNoticeSentAt: null },
          // Re-aviso si el último intento falló otra vez después del último aviso
          { pausePendingNoticeSentAt: { lt: cutoff } },
        ],
      },
      select: {
        id: true,
        brandName: true,
        lastPaymentAttemptAt: true,
        pausePendingNoticeSentAt: true,
      },
    });

    let sent = 0;
    for (const t of candidates) {
      const phone = await this.ownerPhone(t.id);
      if (!phone || !t.lastPaymentAttemptAt) continue;
      const pauseDate = new Date(
        t.lastPaymentAttemptAt.getTime() + PAUSE_DAYS * 24 * 60 * 60 * 1000,
      );
      const message = smsAccountWillPause({
        brandName: t.brandName,
        pauseDate,
      });
      const r = await this.growBusiness.sendSms(t.id, phone, message);
      if (r.ok) {
        await this.prisma.tenant.update({
          where: { id: t.id },
          data: { pausePendingNoticeSentAt: now },
        });
        sent++;
        this.logger.log(`SMS "pausa pendiente" enviado a ${t.brandName} (${phone})`);
      } else {
        this.logger.warn(
          `SMS "pausa pendiente" falló para ${t.brandName}: ${r.message ?? 'unknown'}`,
        );
      }
    }
    return sent;
  }

  /**
   * D+4 desde último intento fallido sin pago: pausar cuenta + SMS "pausada".
   */
  private async suspendOverdueAccounts(now: Date) {
    const cutoff = new Date(now.getTime() - PAUSE_DAYS * 24 * 60 * 60 * 1000);
    const candidates = await this.prisma.tenant.findMany({
      where: {
        status: 'ACTIVE',
        failedPaymentCount: { gt: 0 },
        lastPaymentAttemptAt: { lt: cutoff },
      },
      select: { id: true, brandName: true },
    });

    let suspended = 0;
    for (const t of candidates) {
      await this.prisma.tenant.update({
        where: { id: t.id },
        data: { status: 'SUSPENDED', suspendedAt: now },
      });
      suspended++;
      const phone = await this.ownerPhone(t.id);
      if (phone) {
        const message = smsAccountPaused({ brandName: t.brandName });
        this.growBusiness
          .sendSms(t.id, phone, message)
          .catch((e) =>
            this.logger.warn(`SMS "pausada" falló para ${t.brandName}: ${e?.message ?? e}`),
          );
      }
      this.logger.warn(
        `Tenant ${t.brandName} (${t.id}) auto-pausado por pago no resuelto en ${PAUSE_DAYS} días`,
      );
    }
    return suspended;
  }
}
