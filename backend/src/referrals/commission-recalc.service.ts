import { Injectable, Logger } from '@nestjs/common';
import { CommissionStatus } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { SettingsService } from '../settings/settings.service';

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
    private settings: SettingsService,
  ) {}

  /**
   * FUENTE ÚNICA del precio base del bundle (lo que el cliente paga en
   * Hotmart por el período): Mensual 68 / Trimestral 150 / Semestral 278 /
   * Anual 500 (editables en /admin/branding via Settings). TODA comisión se
   * calcula sobre este monto — NO sobre `priceMonthly × meses` (que daba bases
   * incorrectas: Semestral $300 en vez de $278, Anual $600 en vez de $500).
   * Devuelve 0 si la periodicidad es desconocida.
   */
  async getBundlePrice(periodicity: string | null): Promise<number> {
    const landingPlans = await this.settings.getLandingPlans();
    const map: Record<string, number> = {
      MENSUAL: landingPlans.mensual.price,
      TRIMESTRAL: landingPlans.trimestral.price,
      SEMESTRAL: landingPlans.semestral.price,
      ANUAL: landingPlans.anual.price,
    };
    return map[(periodicity ?? 'MENSUAL').toUpperCase()] ?? 0;
  }

  /**
   * Helper inline (antes vivía en CommissionExceptionsService — lo
   * extrajimos para romper ciclo Admin ↔ Referrals 2026-06-07).
   * Si hay excepción activa para (tenant, recipientCode), usa ese %;
   * sino, fallback.
   */
  private async resolveEffectivePct(
    tenantId: string,
    recipientCodeId: string,
    fallbackPercent: number,
  ): Promise<number> {
    const exc = await this.prisma.commissionException.findUnique({
      where: { tenantId_recipientCodeId: { tenantId, recipientCodeId } },
      select: { customPercent: true, isActive: true },
    });
    if (exc && exc.isActive) return Number(exc.customPercent);
    return fallbackPercent;
  }

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

    // FIX 2026-06-07: las commissions viejas (pre-3-way-split) tienen
    // recipientCodeId=null. Se derivan del use.referralCodeId. Filtro
    // OR para cubrir ambos casos: rows con recipientCodeId seteado
    // explícito + rows con null cuyo use apunta al mismo referralCode.
    const baseStatus = {
      status: { in: [CommissionStatus.PENDING, CommissionStatus.APPROVED] },
    };
    const useTenantFilter = opts.tenantId
      ? { tenantId: opts.tenantId }
      : undefined;
    const where: any = {
      ...baseStatus,
      OR: [
        {
          recipientCodeId: opts.recipientCodeId,
          ...(useTenantFilter ? { referralUse: useTenantFilter } : {}),
        },
        {
          recipientCodeId: null,
          referralUse: {
            referralCodeId: opts.recipientCodeId,
            ...(useTenantFilter ?? {}),
          },
        },
      ],
    };

    const commissions = await this.prisma.commission.findMany({
      where,
      include: {
        referralUse: {
          select: {
            tenantId: true,
            referralCodeId: true,
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

    // FIX 2026-06-07: precios canónicos del bundle (lo que el cliente
    // paga en Hotmart) — Mensual 68 / Trimestral 150 / Semestral 278 /
    // Anual 500. Antes usábamos priceMonthly × bundleMonths del Plan
    // row (legacy ELITE $50 daba 150 para trimestral, OK por suerte,
    // pero PRO $99 daba 297 — bug). Misma fix del dashboard.
    const landingPlans = await this.settings.getLandingPlans();
    const BUNDLE_PRICE: Record<string, number> = {
      MENSUAL: landingPlans.mensual.price,
      TRIMESTRAL: landingPlans.trimestral.price,
      SEMESTRAL: landingPlans.semestral.price,
      ANUAL: landingPlans.anual.price,
    };

    for (const c of commissions) {
      const tenantId = c.referralUse?.tenantId;
      if (!tenantId) continue;
      const periodicity = c.referralUse?.tenant?.planPeriodicity ?? '';
      const basis = BUNDLE_PRICE[periodicity.toUpperCase()] ?? 0;
      if (basis <= 0) continue;

      const pct = await this.resolveEffectivePct(
        tenantId,
        opts.recipientCodeId,
        baseFallbackPct,
      );
      const newAmount = round2((basis * pct) / 100);
      const oldAmount = Number(c.amount);
      // FIX 2026-06-07: si recipientCodeId es null (commissions legacy
      // pre-3-way-split), backfillearlo con el code del use al
      // actualizar — así futuras consultas no fallan otra vez. Si los
      // amounts son iguales pero el recipientCodeId está null, igual
      // actualizamos el campo.
      const needsRecipientBackfill = (c as any).recipientCodeId == null;
      if (newAmount === oldAmount && !needsRecipientBackfill) continue;

      await this.prisma.commission.update({
        where: { id: c.id },
        data: {
          amount: newAmount,
          ...(needsRecipientBackfill
            ? { recipientCodeId: opts.recipientCodeId }
            : {}),
        },
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
