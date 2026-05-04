import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../common/prisma/prisma.service';

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

  constructor(private prisma: PrismaService) {}

  /**
   * Cancela la suscripción del tenant. Si está en TRIAL: marca como CANCELED y
   * mantiene el acceso hasta el fin del trial. Si está ACTIVE: marca para no
   * renovar al final del periodo actual. Si está SUSPENDED: confirma cancelación.
   */
  async cancelSubscription(tenantId: string, reason?: string) {
    const t = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true, status: true, trialEndsAt: true, currentPeriodEnd: true },
    });
    if (!t) throw new Error('Tenant not found');

    // Por ahora, marcamos como CANCELED inmediatamente. Cuando integremos
    // Hotmart, hay que llamar a su API y dejar acceso hasta currentPeriodEnd.
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

  /**
   * Reactiva una cuenta cancelada. Política: una sola reactivación gratis,
   * con +3 días de trial bonus para que pueda configurar su pago. Si ya
   * reactivó antes, debe contactar soporte.
   */
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
    if (r.suspendedCount > 0) {
      this.logger.log(`Daily cron: ${r.suspendedCount} tenant(s) suspended`);
    }
  }

  /** Bloquea tenants con trial expirado o pago fallido prolongado. */
  async runDailyCheck() {
    const now = new Date();
    const expiredTrials = await this.prisma.tenant.findMany({
      where: {
        status: 'TRIAL',
        trialEndsAt: { lt: now },
        currentPeriodEnd: null,
      },
      select: { id: true, brandName: true },
    });

    for (const t of expiredTrials) {
      await this.prisma.tenant.update({
        where: { id: t.id },
        data: { status: 'SUSPENDED', suspendedAt: now },
      });
      this.logger.warn(`Tenant ${t.brandName} (${t.id}) suspended: trial expired`);
    }

    return { suspendedCount: expiredTrials.length };
  }
}
