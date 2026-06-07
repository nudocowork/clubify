import { Injectable, Logger } from '@nestjs/common';
import { CommissionStatus } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CommissionExceptionsService } from '../admin/commission-exceptions.service';

/**
 * Recálculo en tiempo real de comisiones cuando cambia un % (Fase E
 * 2026-06-07).
 *
 * Regla: cambios SOLO afectan PENDING + APPROVED. Las PAID quedan
 * intactas — la UI tiene que avisar al admin antes de cambiar si hay
 * comisiones ya pagadas en ese scope.
 *
 * Cálculo del nuevo amount:
 *   - basis = priceMonthly del Plan × meses del bundle según
 *     tenant.planPeriodicity (mismo cálculo que el cron del reconcile)
 *   - pct = el nuevo % del referralCode, o el de la excepción si existe
 *   - newAmount = basis × pct / 100
 *
 * Toda update queda registrada en AuditLog.
 */
@Injectable()
export class CommissionRecalcService {
  private logger = new Logger(CommissionRecalcService.name);

  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private commissionExceptions: CommissionExceptionsService,
  ) {}

  /**
   * Recalcula las commissions PENDING/APPROVED de un recipientCode.
   * Útil cuando cambia el `commissionPercent` del referralCode mismo
   * (influencer titular, embajador o vendor).
   *
   * Si `tenantId` se pasa, restringe a las commissions de ese tenant
   * (útil cuando cambia una excepción que afecta solo a un cliente).
   */
  async recalcForRecipientCode(opts: {
    recipientCodeId: string;
    tenantId?: string;
    actorId?: string | null;
    reason?: string;
  }): Promise<{ updated: number; skippedPaid: number; affectedAmount: number }> {
    const code = await this.prisma.referralCode.findUnique({
      where: { id: opts.recipientCodeId },
      select: { id: true, commissionPercent: true },
    });
    if (!code) return { updated: 0, skippedPaid: 0, affectedAmount: 0 };

    const where: any = {
      recipientCodeId: opts.recipientCodeId,
      status: { in: [CommissionStatus.PENDING, CommissionStatus.APPROVED] },
    };
    if (opts.tenantId) {
      where.referralUse = { tenantId: opts.tenantId };
    }

    const commissions = await this.prisma.commission.findMany({
      where,
      include: {
        referralUse: {
          select: {
            tenantId: true,
            tenant: {
              select: {
                planPeriodicity: true,
                plan: { select: { priceMonthly: true } },
              },
            },
          },
        },
      },
    });

    // Cuántas PAID hay en el scope (para reportar al admin).
    const skippedPaid = await this.prisma.commission.count({
      where: {
        recipientCodeId: opts.recipientCodeId,
        status: CommissionStatus.PAID,
        ...(opts.tenantId ? { referralUse: { tenantId: opts.tenantId } } : {}),
      },
    });

    let updated = 0;
    let affectedAmount = 0;
    const baseFallbackPct = Number(code.commissionPercent ?? 0);

    for (const c of commissions) {
      const tenantId = c.referralUse?.tenantId;
      if (!tenantId) continue;
      const priceMonthly = Number(
        c.referralUse?.tenant?.plan?.priceMonthly ?? 0,
      );
      if (priceMonthly <= 0) continue;
      const months = bundleMonths(c.referralUse?.tenant?.planPeriodicity ?? null);
      const basis = priceMonthly * months;

      const pct = await this.commissionExceptions.resolvePercent(
        tenantId,
        opts.recipientCodeId,
        baseFallbackPct,
      );
      const newAmount = round2((basis * pct) / 100);
      const oldAmount = Number(c.amount);
      if (newAmount === oldAmount) continue;

      await this.prisma.commission.update({
        where: { id: c.id },
        data: { amount: newAmount },
      });
      updated += 1;
      affectedAmount += Math.abs(newAmount - oldAmount);
      await this.audit.log({
        actorId: opts.actorId ?? null,
        tenantId,
        action: 'commission.recalculated',
        resource: `Commission:${c.id}`,
        metadata: {
          recipientCodeId: opts.recipientCodeId,
          previousAmount: oldAmount,
          newAmount,
          percentApplied: pct,
          reason: opts.reason ?? null,
        },
      });
    }

    if (updated > 0) {
      this.logger.log(
        `Recalc recipientCode=${opts.recipientCodeId} tenant=${opts.tenantId ?? '*'} → ${updated} updated, ${skippedPaid} PAID skipped`,
      );
    }
    return {
      updated,
      skippedPaid,
      affectedAmount: round2(affectedAmount),
    };
  }

  /**
   * Cuenta cuántas commissions PAID hay en un scope dado. Para que el
   * frontend pueda mostrar la advertencia antes del cambio: "este
   * cambio NO afectará 3 comisiones ya pagadas (USD 156)".
   */
  async paidImpactPreview(opts: {
    recipientCodeId: string;
    tenantId?: string;
  }) {
    const where: any = {
      recipientCodeId: opts.recipientCodeId,
      status: CommissionStatus.PAID,
    };
    if (opts.tenantId) {
      where.referralUse = { tenantId: opts.tenantId };
    }
    const paidRows = await this.prisma.commission.findMany({
      where,
      select: { amount: true },
    });
    const paidCount = paidRows.length;
    const paidUsd = round2(
      paidRows.reduce((s, r) => s + Number(r.amount), 0),
    );

    const pendingRows = await this.prisma.commission.findMany({
      where: {
        ...where,
        status: { in: [CommissionStatus.PENDING, CommissionStatus.APPROVED] },
      },
      select: { amount: true },
    });
    return {
      paidCount,
      paidUsd,
      pendingCount: pendingRows.length,
      pendingUsd: round2(
        pendingRows.reduce((s, r) => s + Number(r.amount), 0),
      ),
    };
  }
}

const round2 = (n: number) => Math.round(n * 100) / 100;

function bundleMonths(periodicity: string | null): number {
  switch ((periodicity ?? '').toUpperCase()) {
    case 'TRIMESTRAL':
      return 3;
    case 'SEMESTRAL':
      return 6;
    case 'ANUAL':
      return 12;
    default:
      return 1;
  }
}
