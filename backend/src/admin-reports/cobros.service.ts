import { Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import {
  deriveRenewalState,
  type RenewalConfig,
  type RenewalState,
} from '../billing/dunning';
import {
  getCanonicalBundlePrice,
  CANONICAL_BUNDLE_PRICES,
} from '../common/plan-pricing';
import { normalizePlanPeriod } from '../common/plan-period';

/**
 * Dashboard de cobros (Fase 5) — FUENTE ÚNICA de las 3 tarjetas 🔴🟢🟡 y sus
 * vistas de detalle. Clasifica cada negocio/grupo con `deriveRenewalState` (la
 * MISMA regla que suspende, de la Fase 1/2), así el dashboard, el panel y el
 * motor de dinero nunca se contradicen.
 *
 *   🔴 Próximos cobros   = COBRO_PROXIMO (currentPeriodEnd dentro de la ventana)
 *   🟢 Pagos procesados  = IncomeRecord del rango (dinero REALMENTE cobrado)
 *   🟡 No procesados      = EN_GRACIA + SUSPENDIDO (fallaron / siguen pendientes)
 *
 * Todo respeta el aislamiento por marca (wlId): null = Clubify/global.
 */

const round2 = (n: number) => Math.round(n * 100) / 100;
const num = (x: unknown) => (x == null ? 0 : Number(x));

export type CobrosBucket = 'proximos' | 'procesados' | 'no-procesados';

export interface CobrosSummary {
  proximos: { count: number; amountUsd: number };
  procesados: { count: number; amountUsd: number };
  noProcesados: { count: number; amountUsd: number };
  generatedAt: Date;
}

export interface CobroProximoRow {
  tenantId: string | null;
  groupId: string | null;
  negocio: string;
  esGrupo: boolean;
  fechaCobro: Date | null;
  plan: string;
  periodicidad: string;
  montoUsd: number;
  metodo: string; // 'Hotmart' | 'Stripe' | 'Pago por fuera'
  ultimoPago: Date | null;
  estado: RenewalState;
}

export interface CobroProcesadoRow {
  tenantId: string | null;
  negocio: string;
  tipo: 'Primer pago' | 'Recurrencia';
  plan: string;
  periodicidad: string;
  montoUsd: number;
  metodo: string;
  pasarela: string;
  idTx: string;
  fecha: Date;
}

export interface CobroFallidoRow {
  tenantId: string | null;
  groupId: string | null;
  negocio: string;
  esGrupo: boolean;
  fechaPrevista: Date | null;
  diasVencidos: number;
  estado: RenewalState;
  graceLabel: string | null;
  graceDaysLeft: number | null;
  fechaSuspension: Date | null;
  plan: string;
  periodicidad: string;
  montoUsd: number;
  metodo: string;
  ultimoIntento: Date | null;
}

@Injectable()
export class CobrosService {
  constructor(private prisma: PrismaService) {}

  private async graceDays(): Promise<number> {
    const row = await this.prisma.setting
      .findUnique({ where: { key: 'billing.graceDays' } })
      .catch(() => null);
    const n = row?.value != null ? parseInt(row.value, 10) : NaN;
    return Number.isFinite(n) && n >= 1 && n <= 30 ? n : 5;
  }

  private cfg(graceDays: number, proximoCobroDays = 7): RenewalConfig {
    return {
      graceDays,
      reminderDay: 1,
      noticeDay: 2,
      staleCapDays: 60,
      proximoCobroDays,
    };
  }

  /** Mapa periodicidad → precio canónico (con override del panel de landing). */
  private async canonicalPrices(): Promise<Record<string, number>> {
    const periods = Object.keys(CANONICAL_BUNDLE_PRICES);
    const out: Record<string, number> = {};
    for (const p of periods) {
      out[p] = await getCanonicalBundlePrice(this.prisma, p);
    }
    return out;
  }

  /** Monto del ciclo de un negocio: precio pactado (override) ?? canónico. */
  private amountForTenant(
    t: { subscriptionPriceUsd: unknown; planPeriodicity: string | null },
    canonical: Record<string, number>,
  ): number {
    const real = num(t.subscriptionPriceUsd);
    if (real > 0) return real;
    return canonical[normalizePlanPeriod(t.planPeriodicity)] ?? 0;
  }

  private amountForGroup(
    g: { priceUsd: unknown; planPeriodicity: string | null },
    canonical: Record<string, number>,
  ): number {
    const real = num(g.priceUsd);
    if (real > 0) return real;
    return canonical[normalizePlanPeriod(g.planPeriodicity)] ?? 0;
  }

  private metodoTenant(t: {
    manualPayment: boolean;
    whiteLabelSlug?: string | null;
    stripeSubscriptionId?: string | null;
  }): string {
    if (t.manualPayment) return 'Pago por fuera';
    if (t.stripeSubscriptionId) return 'Stripe';
    return 'Hotmart';
  }

  // ── Carga común: tenants (excluye miembros de grupo) + grupos ──────────────
  private tenantWhere(wlId: string | null) {
    return {
      isCampaignHost: false,
      businessGroupId: null,
      deletedAt: null,
      ...(wlId ? { whiteLabelId: wlId } : {}),
    };
  }

  private tenantSelect() {
    return {
      id: true,
      brandName: true,
      status: true,
      planPeriodicity: true,
      subscriptionPriceUsd: true,
      currentPeriodEnd: true,
      firstFailedAt: true,
      lastPaymentAttemptAt: true,
      lastChargeAt: true,
      failedPaymentCount: true,
      suspendedAt: true,
      manualPayment: true,
      stripeSubscriptionId: true,
    } as const;
  }

  // ── Resumen (las 3 tarjetas) ───────────────────────────────────────────────
  async summary(wlId: string | null, now: Date): Promise<CobrosSummary> {
    const graceDays = await this.graceDays();
    const cfg = this.cfg(graceDays);
    const canonical = await this.canonicalPrices();
    const since7 = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const [tenants, groups, income] = await Promise.all([
      this.prisma.tenant.findMany({
        where: this.tenantWhere(wlId),
        select: this.tenantSelect(),
      }),
      this.prisma.businessGroup.findMany({
        where: { deletedAt: null, ...(wlId ? { whiteLabelId: wlId } : {}) },
        select: {
          id: true,
          name: true,
          status: true,
          planPeriodicity: true,
          priceUsd: true,
          currentPeriodEnd: true,
          failedPaymentCount: true,
          suspendedAt: true,
          lastChargeAt: true,
        },
      }),
      this.prisma.incomeRecord.aggregate({
        where: { saleDate: { gte: since7 }, ...(wlId ? { whiteLabelId: wlId } : {}) },
        _count: { _all: true },
        _sum: { grossUsd: true },
      }),
    ]);

    let proxCount = 0;
    let proxAmt = 0;
    let failCount = 0;
    let failAmt = 0;

    for (const t of tenants) {
      const r = deriveRenewalState(t, now, cfg);
      if (r.state === 'COBRO_PROXIMO') {
        proxCount++;
        proxAmt += this.amountForTenant(t, canonical);
      } else if (r.state === 'EN_GRACIA' || r.state === 'SUSPENDIDO') {
        failCount++;
        failAmt += this.amountForTenant(t, canonical);
      }
    }
    for (const g of groups) {
      const r = deriveRenewalState(
        {
          status: g.status,
          suspendedAt: g.suspendedAt,
          failedPaymentCount: g.failedPaymentCount,
          firstFailedAt: null,
          lastPaymentAttemptAt: null,
          currentPeriodEnd: g.currentPeriodEnd,
          lastChargeAt: g.lastChargeAt,
        },
        now,
        cfg,
      );
      if (r.state === 'COBRO_PROXIMO') {
        proxCount++;
        proxAmt += this.amountForGroup(g, canonical);
      } else if (r.state === 'EN_GRACIA' || r.state === 'SUSPENDIDO') {
        failCount++;
        failAmt += this.amountForGroup(g, canonical);
      }
    }

    return {
      proximos: { count: proxCount, amountUsd: round2(proxAmt) },
      procesados: {
        count: income._count._all,
        amountUsd: round2(num(income._sum.grossUsd)),
      },
      noProcesados: { count: failCount, amountUsd: round2(failAmt) },
      generatedAt: now,
    };
  }

  // ── Detalle de cada bucket ─────────────────────────────────────────────────
  async detail(
    wlId: string | null,
    bucket: CobrosBucket,
    now: Date,
    opts: { days?: number } = {},
  ) {
    if (bucket === 'proximos') return this.detailProximos(wlId, now, opts.days ?? 7);
    if (bucket === 'procesados') return this.detailProcesados(wlId, now, opts.days ?? 7);
    return this.detailNoProcesados(wlId, now, opts.days ?? 30);
  }

  private async detailProximos(
    wlId: string | null,
    now: Date,
    days: number,
  ): Promise<CobroProximoRow[]> {
    const graceDays = await this.graceDays();
    const cfg = this.cfg(graceDays, days);
    const canonical = await this.canonicalPrices();
    const [tenants, groups] = await Promise.all([
      this.prisma.tenant.findMany({
        where: this.tenantWhere(wlId),
        select: this.tenantSelect(),
      }),
      this.prisma.businessGroup.findMany({
        where: { deletedAt: null, ...(wlId ? { whiteLabelId: wlId } : {}) },
        select: {
          id: true,
          name: true,
          status: true,
          planPeriodicity: true,
          priceUsd: true,
          currentPeriodEnd: true,
          failedPaymentCount: true,
          suspendedAt: true,
          lastChargeAt: true,
        },
      }),
    ]);
    const rows: CobroProximoRow[] = [];
    for (const t of tenants) {
      const r = deriveRenewalState(t, now, cfg);
      if (r.state !== 'COBRO_PROXIMO') continue;
      rows.push({
        tenantId: t.id,
        groupId: null,
        negocio: t.brandName,
        esGrupo: false,
        fechaCobro: t.currentPeriodEnd,
        plan: normalizePlanPeriod(t.planPeriodicity),
        periodicidad: normalizePlanPeriod(t.planPeriodicity),
        montoUsd: round2(this.amountForTenant(t, canonical)),
        metodo: this.metodoTenant(t),
        ultimoPago: t.lastChargeAt,
        estado: r.state,
      });
    }
    for (const g of groups) {
      const r = deriveRenewalState(
        {
          status: g.status,
          suspendedAt: g.suspendedAt,
          failedPaymentCount: g.failedPaymentCount,
          firstFailedAt: null,
          lastPaymentAttemptAt: null,
          currentPeriodEnd: g.currentPeriodEnd,
          lastChargeAt: g.lastChargeAt,
        },
        now,
        cfg,
      );
      if (r.state !== 'COBRO_PROXIMO') continue;
      rows.push({
        tenantId: null,
        groupId: g.id,
        negocio: g.name,
        esGrupo: true,
        fechaCobro: g.currentPeriodEnd,
        plan: normalizePlanPeriod(g.planPeriodicity),
        periodicidad: normalizePlanPeriod(g.planPeriodicity),
        montoUsd: round2(this.amountForGroup(g, canonical)),
        metodo: 'Hotmart',
        ultimoPago: g.lastChargeAt,
        estado: r.state,
      });
    }
    rows.sort(
      (a, b) => (a.fechaCobro?.getTime() ?? 0) - (b.fechaCobro?.getTime() ?? 0),
    );
    return rows;
  }

  private async detailProcesados(
    wlId: string | null,
    now: Date,
    days: number,
  ): Promise<CobroProcesadoRow[]> {
    const since = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
    const recs = await this.prisma.incomeRecord.findMany({
      where: { saleDate: { gte: since }, ...(wlId ? { whiteLabelId: wlId } : {}) },
      orderBy: { saleDate: 'desc' },
      take: 500,
      select: {
        tenantId: true,
        brandName: true,
        planPeriodicity: true,
        productName: true,
        grossUsd: true,
        isFirstPayment: true,
        gateway: true,
        externalTxId: true,
        saleDate: true,
      },
    });
    return recs.map((r) => ({
      tenantId: r.tenantId,
      negocio: r.brandName ?? '—',
      tipo: r.isFirstPayment ? ('Primer pago' as const) : ('Recurrencia' as const),
      plan: r.productName ?? normalizePlanPeriod(r.planPeriodicity),
      periodicidad: normalizePlanPeriod(r.planPeriodicity),
      montoUsd: round2(num(r.grossUsd)),
      metodo: r.gateway === 'MANUAL' ? 'Pago por fuera' : 'Tarjeta',
      pasarela: r.gateway,
      idTx: r.externalTxId,
      fecha: r.saleDate,
    }));
  }

  private async detailNoProcesados(
    wlId: string | null,
    now: Date,
    days: number,
  ): Promise<CobroFallidoRow[]> {
    const graceDays = await this.graceDays();
    const cfg = this.cfg(graceDays);
    const canonical = await this.canonicalPrices();
    const cutoff = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
    const [tenants, groups] = await Promise.all([
      this.prisma.tenant.findMany({
        where: this.tenantWhere(wlId),
        select: this.tenantSelect(),
      }),
      this.prisma.businessGroup.findMany({
        where: { deletedAt: null, ...(wlId ? { whiteLabelId: wlId } : {}) },
        select: {
          id: true,
          name: true,
          status: true,
          planPeriodicity: true,
          priceUsd: true,
          currentPeriodEnd: true,
          failedPaymentCount: true,
          suspendedAt: true,
          lastChargeAt: true,
        },
      }),
    ]);
    const rows: CobroFallidoRow[] = [];
    const pushIf = (
      r: ReturnType<typeof deriveRenewalState>,
      base: Omit<
        CobroFallidoRow,
        'diasVencidos' | 'estado' | 'graceLabel' | 'graceDaysLeft' | 'fechaSuspension'
      >,
    ) => {
      if (r.state !== 'EN_GRACIA' && r.state !== 'SUSPENDIDO') return;
      // Filtro de rango: los SUSPENDIDO viejos (fuera de la ventana) no saturan.
      if (
        r.state === 'SUSPENDIDO' &&
        base.fechaPrevista &&
        base.fechaPrevista.getTime() < cutoff.getTime()
      )
        return;
      rows.push({
        ...base,
        diasVencidos: r.daysOverdue,
        estado: r.state,
        graceLabel: r.graceLabel,
        graceDaysLeft: r.graceDaysLeft,
        fechaSuspension: r.pauseDate,
      });
    };
    for (const t of tenants) {
      const r = deriveRenewalState(t, now, cfg);
      pushIf(r, {
        tenantId: t.id,
        groupId: null,
        negocio: t.brandName,
        esGrupo: false,
        fechaPrevista: t.firstFailedAt ?? t.currentPeriodEnd,
        plan: normalizePlanPeriod(t.planPeriodicity),
        periodicidad: normalizePlanPeriod(t.planPeriodicity),
        montoUsd: round2(this.amountForTenant(t, canonical)),
        metodo: this.metodoTenant(t),
        ultimoIntento: t.lastPaymentAttemptAt ?? t.currentPeriodEnd,
      });
    }
    for (const g of groups) {
      const r = deriveRenewalState(
        {
          status: g.status,
          suspendedAt: g.suspendedAt,
          failedPaymentCount: g.failedPaymentCount,
          firstFailedAt: null,
          lastPaymentAttemptAt: null,
          currentPeriodEnd: g.currentPeriodEnd,
          lastChargeAt: g.lastChargeAt,
        },
        now,
        cfg,
      );
      pushIf(r, {
        tenantId: null,
        groupId: g.id,
        negocio: g.name,
        esGrupo: true,
        fechaPrevista: g.currentPeriodEnd,
        plan: normalizePlanPeriod(g.planPeriodicity),
        periodicidad: normalizePlanPeriod(g.planPeriodicity),
        montoUsd: round2(this.amountForGroup(g, canonical)),
        metodo: 'Hotmart',
        ultimoIntento: g.currentPeriodEnd,
      });
    }
    // Más urgentes primero: más días vencidos arriba.
    rows.sort((a, b) => b.diasVencidos - a.diasVencidos);
    return rows;
  }
}
