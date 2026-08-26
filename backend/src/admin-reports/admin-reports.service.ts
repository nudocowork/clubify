import { ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../common/prisma/prisma.service';
import { AuthUser } from '../common/decorators/current-user.decorator';
import { SettingsService } from '../settings/settings.service';
import { normalizePlanPeriod, addPlanPeriod, bundleMonths } from '../common/plan-period';
import { cycleCreditCostForTenant } from '../common/business-types';
import {
  bogotaYmd,
  bogotaDayStartUtc,
  addDaysYmd,
  parseYmd,
  fmtYmd,
} from '../referrals/cutoff-calendar';
import { WhiteLabelNotificationsService } from '../white-label-notifications/white-label-notifications.service';

/**
 * Agrega el token de ruteo `src=wl_<whiteLabelId>` a un link de compra Hotmart.
 * El checkout Hotmart lo propaga como `tracking.source` en el webhook, y
 * hotmart.service lo usa como 1ª prioridad para acreditar los créditos a la
 * marca correcta (sin depender del correo del comprador). Reemplaza un `src`
 * previo si existiera. Devuelve la URL igual si está vacía o es inválida.
 */
function withWlToken(rawUrl: string | null | undefined, wlId: string): string {
  const url = (rawUrl ?? '').trim();
  if (!url) return url;
  try {
    const u = new URL(url);
    u.searchParams.set('src', `wl_${wlId}`);
    return u.toString();
  } catch {
    // URL relativa/no parseable → fallback manual conservando query previa.
    const base = url.replace(/([?&])src=[^&]*/i, '$1').replace(/[?&]$/, '');
    const sep = base.includes('?') ? '&' : '?';
    return `${base}${sep}src=wl_${wlId}`;
  }
}

/**
 * Servicio de reportes/rankings/dashboard para SUPER_ADMIN.
 *
 * Foco: agregaciones cross-tenant, cross-afiliado de la nueva jerarquía
 * influencer → embajador → vendedor. Usa raw SQL cuando hay CTEs no
 * triviales (rankings con range filter); el resto via Prisma estándar.
 *
 * Convención de "cobrado" / "facturación":
 *  - Una venta efectiva se modela como Commission row generada por el
 *    webhook Hotmart (cualquier paymentStatus). Para evitar inflar contando
 *    múltiples rows del 3-way split como múltiples ventas, agrupamos por
 *    hotmartTransactionId (cada transacción única = 1 venta).
 *  - Cuando no hay hotmartTransactionId (commissions históricas
 *    pre-3-way), agrupamos por referralUseId + createdAt (día) como
 *    fallback aproximado.
 *  - Facturación = sum(amount paid by client) por venta. Como el webhook
 *    sólo guarda commissions y no el monto total cobrado al cliente,
 *    derivamos facturación reconstruyendo desde commission.amount /
 *    commissionPercent del recipientCode. Por estabilidad usamos el monto
 *    del plan.priceMonthly del tenant en su periodicidad.
 *  - Comisión generada = sum(commission.amount).
 *  - Comisión pagada = sum(commission.amountPaid) (PAID + PARTIAL).
 *  - Comisión pendiente = sum(amount - amountPaid).
 */
/** Ventana (días) para reembolsar manualmente un crédito CONSUME. */
const REFUND_WINDOW_DAYS = 5;

@Injectable()
export class AdminReportsService {
  private readonly logger = new Logger(AdminReportsService.name);
  constructor(
    private prisma: PrismaService,
    private settings: SettingsService,
    private wlNotifications: WhiteLabelNotificationsService,
  ) {}

  // P (PDF 2026-07-01): caché corta del dashboard por (marca, rango). Al
  // cambiar de rango en el panel se recomputaba TODO (tenants/comisiones/mapa,
  // que no dependen del rango) → sensación de lag. Con TTL de 45s, alternar
  // entre rangos ya vistos es instantáneo. Keyed por wlId → sin fugas entre
  // marcas. Singleton NestJS: seguro guardar estado acá (no es 'use client').
  private dashCache = new Map<string, { at: number; payload: unknown }>();
  private readonly DASH_TTL_MS = 45_000;

  // ============================================================
  //                  REPORTES POR EMBAJADOR
  // ============================================================

  /**
   * Lista de embajadores con métricas agregadas.
   * Un embajador puede ser AMBASSADOR (con o sin parent influencer)
   * o INFLUENCER que tiene embajadores debajo. Para este reporte
   * tratamos AMBASSADOR como "embajador" en el sentido del negocio.
   *
   * - ventasTotales: count de tenants distintos atribuidos al embajador
   *   directamente (via ReferralUse del code del embajador) o
   *   indirectamente via sus VENDOR hijos.
   * - facturacion: sum(commission.amount) histórico generado por toda
   *   la línea (embajador + vendors). Es una proxy del revenue cobrado
   *   a clientes derivado de las commissions.
   * - comisionGenerada: sum(commission.amount) cuyo recipientCode es
   *   el embajador.
   * - vendedoresActivos: count childVendors con isActive=true.
   */
  async listAmbassadors(user: AuthUser) {
    if (user.role !== 'SUPER_ADMIN') throw new ForbiddenException();

    const ambassadors = await this.prisma.referralCode.findMany({
      // Aislamiento por marca: cada Master Admin ve solo los suyos.
      where: {
        role: 'AMBASSADOR',
        ...(user.whiteLabelId ? { whiteLabelId: user.whiteLabelId } : {}),
      },
      include: {
        parentCode: { select: { id: true, ownerName: true, code: true } },
        childVendors: {
          select: { id: true, isActive: true },
        },
        receivedCommissions: {
          select: {
            amount: true,
            amountPaid: true,
            status: true,
            paymentStatus: true,
            hotmartTransactionId: true,
            referralUseId: true,
          },
        },
        uses: {
          select: { id: true, tenantId: true, status: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    // Para facturación incluimos commissions de TODOS los vendedores que
    // cuelgan del embajador (la línea completa). Sumamos amount de los
    // 3 actores del split = total cobrado al cliente.
    const vendorIds = ambassadors.flatMap((a) => a.childVendors.map((v) => v.id));
    const vendorCommissions = vendorIds.length
      ? await this.prisma.commission.findMany({
          where: { recipientCodeId: { in: vendorIds } },
          select: {
            recipientCodeId: true,
            amount: true,
            hotmartTransactionId: true,
          },
        })
      : [];

    // Atribuir cada vendor al embajador padre.
    const vendorToAmbassador = new Map<string, string>();
    for (const a of ambassadors) {
      for (const v of a.childVendors) vendorToAmbassador.set(v.id, a.id);
    }
    const billingByAmbassador = new Map<string, Set<string>>();
    for (const vc of vendorCommissions) {
      const ambId = vendorToAmbassador.get(vc.recipientCodeId ?? '') ?? null;
      if (!ambId) continue;
      const set = billingByAmbassador.get(ambId) ?? new Set<string>();
      if (vc.hotmartTransactionId) set.add(vc.hotmartTransactionId);
      billingByAmbassador.set(ambId, set);
    }

    const round2 = (n: number) => Math.round(n * 100) / 100;
    return ambassadors.map((a) => {
      const tenantIds = new Set<string>();
      for (const u of a.uses) {
        if (u.tenantId) tenantIds.add(u.tenantId);
      }
      const commGenerated = a.receivedCommissions.reduce(
        (s, c) => s + Number(c.amount),
        0,
      );
      const commPaid = a.receivedCommissions.reduce(
        (s, c) => s + Number(c.amountPaid ?? 0),
        0,
      );
      const commPending = a.receivedCommissions.reduce(
        (s, c) => s + Math.max(0, Number(c.amount) - Number(c.amountPaid ?? 0)),
        0,
      );

      // Facturación aproximada: como ventas efectivas usamos commissions
      // únicas por hotmartTransactionId. Sumamos amount de cada
      // commission del embajador como proxy de facturación atribuida.
      // (El monto cobrado al cliente real se reconstruye mejor desde el
      // detalle, donde sumamos los 3 actores del split por transacción.)
      const ambassadorTxIds = new Set(
        a.receivedCommissions
          .map((c) => c.hotmartTransactionId)
          .filter(Boolean) as string[],
      );
      const vendorTxIds = billingByAmbassador.get(a.id) ?? new Set<string>();
      const ventasTotales = new Set<string>([
        ...ambassadorTxIds,
        ...vendorTxIds,
      ]).size;

      // HOTFIX 2026-06-05 (bug #9 CRÍTICO): facturación NO es lo mismo
      // que comisión generada. Antes ambas tenían el mismo valor con
      // labels distintos → UI engañosa. Aproximación: backsolve la
      // facturación dividiendo commission por commissionPercent. Si
      // commPct=20% y commGenerated=$200, la empresa facturó ≈ $1000
      // de los tenants atribuidos. Si commissionPercent es 0 o null,
      // dejamos null (no estimable).
      const ambPct = Number(a.commissionPercent ?? 0);
      const facturacionEstimadaUsd =
        ambPct > 0 ? round2((commGenerated * 100) / ambPct) : null;

      return {
        id: a.id,
        code: a.code,
        ownerName: a.ownerName,
        ownerEmail: a.ownerEmail,
        ownerWhatsapp: a.ownerWhatsapp,
        isActive: a.isActive,
        parentInfluencerName: a.parentCode?.ownerName ?? null,
        parentInfluencerCode: a.parentCode?.code ?? null,
        tenantsCount: tenantIds.size,
        ventasTotales,
        // facturacionUsd: aproximación basada en backsolve por %.
        facturacionUsd: facturacionEstimadaUsd,
        comisionGeneradaUsd: round2(commGenerated),
        comisionPagadaUsd: round2(commPaid),
        comisionPendienteUsd: round2(commPending),
        vendedoresActivos: a.childVendors.filter((v) => v.isActive).length,
        vendedoresTotal: a.childVendors.length,
        createdAt: a.createdAt,
      };
    });
  }

  /**
   * Detalle de un embajador: producción por vendedor + lista tenants +
   * timeline de las commissions.
   */
  async ambassadorDetail(user: AuthUser, id: string) {
    if (user.role !== 'SUPER_ADMIN') throw new ForbiddenException();
    const amb = await this.prisma.referralCode.findUnique({
      where: { id },
      include: {
        parentCode: { select: { id: true, ownerName: true, code: true } },
        childVendors: {
          include: {
            receivedCommissions: {
              select: {
                amount: true,
                amountPaid: true,
                status: true,
                paymentStatus: true,
                hotmartTransactionId: true,
                createdAt: true,
              },
            },
            uses: {
              select: {
                id: true,
                tenantId: true,
                status: true,
                createdAt: true,
                tenant: {
                  select: {
                    brandName: true,
                    status: true,
                    plan: { select: { name: true, priceMonthly: true } },
                  },
                },
              },
            },
          },
        },
        receivedCommissions: {
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            amount: true,
            amountPaid: true,
            status: true,
            paymentStatus: true,
            hotmartTransactionId: true,
            createdAt: true,
            referralUse: {
              select: {
                tenantId: true,
                tenant: { select: { brandName: true } },
              },
            },
          },
        },
        uses: {
          include: {
            tenant: {
              select: {
                id: true,
                brandName: true,
                status: true,
                currentPeriodEnd: true,
                planPeriodicity: true,
                plan: { select: { name: true, priceMonthly: true } },
              },
            },
          },
          orderBy: { createdAt: 'desc' },
        },
      },
    });
    if (!amb || amb.role !== 'AMBASSADOR') {
      throw new NotFoundException('Embajador no encontrado');
    }

    const round2 = (n: number) => Math.round(n * 100) / 100;

    const vendors = amb.childVendors.map((v) => {
      const gen = v.receivedCommissions.reduce(
        (s, c) => s + Number(c.amount),
        0,
      );
      const paid = v.receivedCommissions.reduce(
        (s, c) => s + Number(c.amountPaid ?? 0),
        0,
      );
      const pending = v.receivedCommissions.reduce(
        (s, c) => s + Math.max(0, Number(c.amount) - Number(c.amountPaid ?? 0)),
        0,
      );
      const tenantIds = new Set<string>();
      for (const u of v.uses) if (u.tenantId) tenantIds.add(u.tenantId);
      return {
        id: v.id,
        code: v.code,
        ownerName: v.ownerName,
        commissionPercent: Number(v.commissionPercent ?? 0),
        isActive: v.isActive,
        salesCount: tenantIds.size,
        comisionGeneradaUsd: round2(gen),
        comisionPagadaUsd: round2(paid),
        comisionPendienteUsd: round2(pending),
      };
    });

    const tenants = amb.uses.map((u) => ({
      referralUseId: u.id,
      tenantId: u.tenantId,
      brandName: u.tenant?.brandName ?? '—',
      tenantStatus: u.tenant?.status ?? '—',
      planName: u.tenant?.plan?.name ?? null,
      planPriceMonthly: Number(u.tenant?.plan?.priceMonthly ?? 0),
      planPeriodicity: u.tenant?.planPeriodicity ?? null,
      currentPeriodEnd: u.tenant?.currentPeriodEnd ?? null,
      useStatus: u.status,
      signedUpAt: u.createdAt,
      convertedAt: u.convertedAt,
    }));

    const timeline = amb.receivedCommissions.map((c) => ({
      id: c.id,
      amount: Number(c.amount),
      amountPaid: Number(c.amountPaid ?? 0),
      status: c.status,
      paymentStatus: c.paymentStatus,
      hotmartTransactionId: c.hotmartTransactionId,
      createdAt: c.createdAt,
      tenantBrand: c.referralUse?.tenant?.brandName ?? null,
    }));

    const totalGenerated = amb.receivedCommissions.reduce(
      (s, c) => s + Number(c.amount),
      0,
    );
    const totalPaid = amb.receivedCommissions.reduce(
      (s, c) => s + Number(c.amountPaid ?? 0),
      0,
    );

    return {
      id: amb.id,
      code: amb.code,
      ownerName: amb.ownerName,
      ownerEmail: amb.ownerEmail,
      ownerWhatsapp: amb.ownerWhatsapp,
      isActive: amb.isActive,
      parent: amb.parentCode
        ? { id: amb.parentCode.id, code: amb.parentCode.code, name: amb.parentCode.ownerName }
        : null,
      totals: {
        ventasTotales: tenants.length,
        comisionGeneradaUsd: round2(totalGenerated),
        comisionPagadaUsd: round2(totalPaid),
        comisionPendienteUsd: round2(totalGenerated - totalPaid),
        vendedoresActivos: vendors.filter((v) => v.isActive).length,
      },
      vendors,
      tenants,
      timeline,
    };
  }

  // ============================================================
  //                  REPORTES POR VENDEDOR
  // ============================================================

  async listVendors(user: AuthUser) {
    if (user.role !== 'SUPER_ADMIN') throw new ForbiddenException();
    const vendors = await this.prisma.referralCode.findMany({
      // Aislamiento por marca: cada Master Admin ve solo los suyos.
      where: {
        role: 'VENDOR',
        ...(user.whiteLabelId ? { whiteLabelId: user.whiteLabelId } : {}),
      },
      include: {
        parentEmbajadorCode: {
          select: { id: true, ownerName: true, code: true },
        },
        receivedCommissions: {
          select: {
            amount: true,
            amountPaid: true,
            status: true,
            paymentStatus: true,
            hotmartTransactionId: true,
          },
        },
        uses: { select: { id: true, tenantId: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    const round2 = (n: number) => Math.round(n * 100) / 100;
    return vendors.map((v) => {
      const tenantIds = new Set<string>();
      for (const u of v.uses) if (u.tenantId) tenantIds.add(u.tenantId);
      const ventasUnicas = new Set(
        v.receivedCommissions
          .map((c) => c.hotmartTransactionId)
          .filter(Boolean) as string[],
      );
      // Si no hay hotmartTransactionId fallback: cada commission = 1 venta
      const ventasRealizadas =
        ventasUnicas.size > 0 ? ventasUnicas.size : v.receivedCommissions.length;
      const acumulada = v.receivedCommissions.reduce(
        (s, c) => s + Number(c.amount),
        0,
      );
      const pagada = v.receivedCommissions.reduce(
        (s, c) => s + Number(c.amountPaid ?? 0),
        0,
      );
      const pendiente = v.receivedCommissions.reduce(
        (s, c) => s + Math.max(0, Number(c.amount) - Number(c.amountPaid ?? 0)),
        0,
      );
      return {
        id: v.id,
        code: v.code,
        ownerName: v.ownerName,
        ownerEmail: v.ownerEmail,
        ownerWhatsapp: v.ownerWhatsapp,
        commissionPercent: Number(v.commissionPercent ?? 0),
        isActive: v.isActive,
        parentEmbajadorName: v.parentEmbajadorCode?.ownerName ?? null,
        parentEmbajadorCode: v.parentEmbajadorCode?.code ?? null,
        ventasRealizadas,
        tenantsCount: tenantIds.size,
        comisionAcumuladaUsd: round2(acumulada),
        comisionPagadaUsd: round2(pagada),
        comisionPendienteUsd: round2(pendiente),
        createdAt: v.createdAt,
      };
    });
  }

  async vendorDetail(user: AuthUser, id: string) {
    if (user.role !== 'SUPER_ADMIN') throw new ForbiddenException();
    const v = await this.prisma.referralCode.findUnique({
      where: { id },
      include: {
        parentEmbajadorCode: {
          select: { id: true, ownerName: true, code: true },
        },
        receivedCommissions: {
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            amount: true,
            amountPaid: true,
            status: true,
            paymentStatus: true,
            hotmartTransactionId: true,
            createdAt: true,
            referralUse: {
              select: {
                tenantId: true,
                tenant: { select: { brandName: true, status: true } },
              },
            },
          },
        },
        uses: {
          include: {
            tenant: {
              select: {
                id: true,
                brandName: true,
                status: true,
                plan: { select: { name: true, priceMonthly: true } },
                planPeriodicity: true,
                currentPeriodEnd: true,
              },
            },
          },
          orderBy: { createdAt: 'desc' },
        },
      },
    });
    if (!v || v.role !== 'VENDOR') {
      throw new NotFoundException('Vendedor no encontrado');
    }

    const round2 = (n: number) => Math.round(n * 100) / 100;
    const totalGen = v.receivedCommissions.reduce(
      (s, c) => s + Number(c.amount),
      0,
    );
    const totalPaid = v.receivedCommissions.reduce(
      (s, c) => s + Number(c.amountPaid ?? 0),
      0,
    );
    return {
      id: v.id,
      code: v.code,
      ownerName: v.ownerName,
      ownerEmail: v.ownerEmail,
      ownerWhatsapp: v.ownerWhatsapp,
      commissionPercent: Number(v.commissionPercent ?? 0),
      isActive: v.isActive,
      parentEmbajador: v.parentEmbajadorCode
        ? {
            id: v.parentEmbajadorCode.id,
            code: v.parentEmbajadorCode.code,
            name: v.parentEmbajadorCode.ownerName,
          }
        : null,
      totals: {
        ventasRealizadas: v.uses.length,
        comisionAcumuladaUsd: round2(totalGen),
        comisionPagadaUsd: round2(totalPaid),
        comisionPendienteUsd: round2(totalGen - totalPaid),
      },
      sales: v.uses.map((u) => ({
        referralUseId: u.id,
        tenantId: u.tenantId,
        brandName: u.tenant?.brandName ?? '—',
        tenantStatus: u.tenant?.status ?? '—',
        planName: u.tenant?.plan?.name ?? null,
        planPeriodicity: u.tenant?.planPeriodicity ?? null,
        planPriceMonthly: Number(u.tenant?.plan?.priceMonthly ?? 0),
        currentPeriodEnd: u.tenant?.currentPeriodEnd ?? null,
        useStatus: u.status,
        signedUpAt: u.createdAt,
        convertedAt: u.convertedAt,
      })),
      commissions: v.receivedCommissions.map((c) => ({
        id: c.id,
        amount: Number(c.amount),
        amountPaid: Number(c.amountPaid ?? 0),
        status: c.status,
        paymentStatus: c.paymentStatus,
        hotmartTransactionId: c.hotmartTransactionId,
        createdAt: c.createdAt,
        tenantBrand: c.referralUse?.tenant?.brandName ?? null,
      })),
    };
  }

  // ============================================================
  //                       RANKINGS
  // ============================================================

  /**
   * Rankings unificados por role + metric + range.
   * role: INFLUENCER | AMBASSADOR | VENDOR
   * metric: sales (count tenants vía commissions únicas) | revenue
   *   (sum commission.amount como proxy facturación) | commissions
   *   (sum commission.amount)
   * range: 7d | 30d | 90d | all
   *
   * Notas:
   *  - revenue y commissions actualmente son numéricamente iguales en
   *    este modelo (no guardamos el monto cobrado al cliente, sólo lo que
   *    se atribuye al recipientCode). Diferencia: revenue agrupa por
   *    transacción única y suma TODAS las commissions de esa transacción
   *    (proxy facturación) — commissions sólo el monto del individuo.
   */
  async rankings(
    user: AuthUser,
    opts: {
      role: 'INFLUENCER' | 'AMBASSADOR' | 'VENDOR';
      metric: 'sales' | 'revenue' | 'commissions';
      range: '7d' | '30d' | '90d' | 'all';
      limit?: number;
    },
  ) {
    if (user.role !== 'SUPER_ADMIN') throw new ForbiddenException();
    const limit = Math.max(1, Math.min(100, opts.limit ?? 20));
    const sinceDate = this.rangeToSince(opts.range);

    const codes = await this.prisma.referralCode.findMany({
      // Aislamiento por marca: rankings solo de los afiliados de la marca.
      where: {
        role: opts.role,
        isActive: true,
        ...(user.whiteLabelId ? { whiteLabelId: user.whiteLabelId } : {}),
      },
      select: {
        id: true,
        code: true,
        ownerName: true,
        ownerEmail: true,
        commissionPercent: true,
      },
    });
    if (codes.length === 0) {
      return { role: opts.role, metric: opts.metric, range: opts.range, rows: [] };
    }
    const codeIds = codes.map((c) => c.id);

    // Trae commissions del rango para todos los codes del role.
    const commissions = await this.prisma.commission.findMany({
      where: {
        recipientCodeId: { in: codeIds },
        ...(sinceDate ? { createdAt: { gte: sinceDate } } : {}),
      },
      select: {
        recipientCodeId: true,
        amount: true,
        hotmartTransactionId: true,
        referralUseId: true,
      },
    });

    // Para "sales" usamos commissions únicas por hotmartTransactionId
    // (1 tx = 1 venta). Fallback referralUseId si no hay txId.
    const acc = new Map<
      string,
      { commissionSum: number; salesSet: Set<string> }
    >();
    for (const c of commissions) {
      if (!c.recipientCodeId) continue;
      const row = acc.get(c.recipientCodeId) ?? {
        commissionSum: 0,
        salesSet: new Set<string>(),
      };
      row.commissionSum += Number(c.amount);
      const key = c.hotmartTransactionId ?? `use:${c.referralUseId}`;
      row.salesSet.add(key);
      acc.set(c.recipientCodeId, row);
    }

    const round2 = (n: number) => Math.round(n * 100) / 100;
    const rows = codes
      .map((c) => {
        const a = acc.get(c.id) ?? {
          commissionSum: 0,
          salesSet: new Set<string>(),
        };
        return {
          id: c.id,
          code: c.code,
          ownerName: c.ownerName,
          ownerEmail: c.ownerEmail,
          commissionPercent: Number(c.commissionPercent ?? 0),
          sales: a.salesSet.size,
          revenueUsd: round2(a.commissionSum),
          commissionsUsd: round2(a.commissionSum),
        };
      })
      .sort((a, b) => {
        const ka = this.metricKey(a, opts.metric);
        const kb = this.metricKey(b, opts.metric);
        return kb - ka;
      })
      .slice(0, limit)
      .map((r, idx) => ({ ...r, rank: idx + 1 }));

    return {
      role: opts.role,
      metric: opts.metric,
      range: opts.range,
      rows,
    };
  }

  private metricKey(
    r: { sales: number; revenueUsd: number; commissionsUsd: number },
    metric: 'sales' | 'revenue' | 'commissions',
  ) {
    if (metric === 'sales') return r.sales;
    if (metric === 'revenue') return r.revenueUsd;
    return r.commissionsUsd;
  }

  private rangeToSince(range: '7d' | '30d' | '90d' | 'all'): Date | null {
    if (range === 'all') return null;
    const days = range === '7d' ? 7 : range === '30d' ? 30 : 90;
    return new Date(Date.now() - days * 86400_000);
  }

  // ============================================================
  //                    DASHBOARD METRICS
  // ============================================================

  /**
   * Métricas del dashboard /admin/dashboard. Suma datos del mes en curso
   * (1° de mes 00:00 → ahora) y proyecciones próximas (próximas
   * renovaciones en 30 días).
   *
   * - Comisiones generadas este mes: sum(commission.amount) creadas
   *   entre startOfMonth y now.
   * - Comisiones pendientes: sum(amount - amountPaid) histórico
   *   (no filtra mes — el dueño quiere saber TODO lo que le deben pagar).
   * - Comisiones pagadas este mes: sum(amountPaid) creadas este mes.
   * - Próximas renovaciones: count tenants con currentPeriodEnd en
   *   próximos 30 días.
   * - Activos / vencidos: status counts.
   * - Ventas por plan + facturación: para 4 plans (Mensual/Trim/Sem/Anual)
   *   contamos tenants ACTIVE por planPeriodicity y sumamos plan price.
   */
  async dashboardMetrics(user: AuthUser) {
    if (user.role !== 'SUPER_ADMIN') throw new ForbiddenException();

    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const in30 = new Date(now.getTime() + 30 * 86400_000);

    const [
      monthCommissions,
      pendingAggAll,
      paidThisMonthAgg,
      upcomingRenewals,
      activeTenants,
      expiredTenants,
      tenantsByPeriodicityActive,
    ] = await Promise.all([
      // HOTFIX 2026-06-05 (bug #7 CRÍTICO): NO sumar `amount` plano —
      // eso infla ~3× porque por cada sale hay 3 commission rows
      // (influencer/embajador/vendor). El "total comisiones generadas
      // este mes" es el monto que la empresa va a desembolsar, que es
      // la suma de TODAS las rows (las 3) — efectivamente OK porque
      // cada row es un gasto distinto. Mantenemos el sum pero
      // documentamos: representa el COSTO total de comisiones, no
      // el monto facturado. Para el monto facturado por sales del mes
      // necesitaríamos otro query agrupado por hotmartTransactionId.
      this.prisma.commission.aggregate({
        where: { createdAt: { gte: startOfMonth } },
        _sum: { amount: true, amountPaid: true },
      }),
      // Pending = (PENDING + APPROVED) con outstanding (amount − amountPaid).
      // HOTFIX 2026-06-05: usamos aggregate para no traer N rows a memoria.
      // FIX 2026-06-16 (#14/#37): antes { not: REJECTED } metía RETAINED
      // (congelada) y PAID en el pool → divergía de Referidos/Comisiones.
      // Definición canónica única.
      this.prisma.commission.aggregate({
        where: { status: { in: ['PENDING', 'APPROVED'] } },
        _sum: { amount: true, amountPaid: true },
      }),
      this.prisma.commission.aggregate({
        where: {
          createdAt: { gte: startOfMonth },
          paymentStatus: { in: ['PAID', 'PARTIAL'] },
        },
        _sum: { amountPaid: true },
      }),
      this.prisma.tenant.count({
        where: { currentPeriodEnd: { gte: now, lte: in30 } },
      }),
      // HOTFIX 2026-06-05 (bug #17): activos = ACTIVE + currentPeriodEnd
      // futuro (no vencido). Antes ACTIVE solo, que solapaba con
      // "vencidos" cuando currentPeriodEnd < now.
      this.prisma.tenant.count({
        where: {
          status: 'ACTIVE',
          OR: [
            { currentPeriodEnd: null },
            { currentPeriodEnd: { gte: now } },
          ],
        },
      }),
      // "Vencidos": SUSPENDED solamente (los ACTIVE con
      // currentPeriodEnd<now son TECNICAMENTE vencidos pero el
      // billing cron los pasará a SUSPENDED. Acá contamos solo lo que
      // YA está formalmente vencido para no solapar con activos).
      this.prisma.tenant.count({
        where: { status: 'SUSPENDED' },
      }),
      this.prisma.tenant.groupBy({
        by: ['planPeriodicity'],
        where: { status: 'ACTIVE' },
        _count: { _all: true },
      }),
    ]);

    const round2 = (n: number) => Math.round(n * 100) / 100;
    // HOTFIX 2026-06-05: pending derivado del aggregate (sum amount - sum
    // amountPaid). Antes hacíamos findMany y reduce — N+1 a escala.
    const pendingTotal = Math.max(
      0,
      Number(pendingAggAll._sum.amount ?? 0) -
        Number(pendingAggAll._sum.amountPaid ?? 0),
    );

    // Para facturación por plan necesitamos el precio mensual de cada plan
    // ponderado por periodicidad. Asumimos:
    //  - MENSUAL = priceMonthly
    //  - TRIMESTRAL = priceMonthly * 3 (o lo que se cobra en ciclo)
    //  - SEMESTRAL = priceMonthly * 6
    //  - ANUAL = priceMonthly * 12
    // Como no tenemos el precio efectivo por periodo guardado, tomamos
    // el precio del default plan Elite (todos los tenants comparten plan).
    const plans = await this.prisma.plan.findMany({
      select: { id: true, name: true, priceMonthly: true, isActive: true },
    });

    // Para cada periodicidad, tenants activos + sum facturación estimada
    // (priceMonthly * multiplicador). Multiplicador = ciclos por año / 12
    // es lo "anual". Pero acá lo que importa es lo "cobrado por ciclo".
    const PERIOD_MULT: Record<string, { cycle: number; label: string }> = {
      MENSUAL: { cycle: 1, label: 'Mensual' },
      TRIMESTRAL: { cycle: 3, label: 'Trimestral' },
      SEMESTRAL: { cycle: 6, label: 'Semestral' },
      ANUAL: { cycle: 12, label: 'Anual' },
    };

    // Default plan price (Elite). Si hay varios planes, tomamos el más
    // alto activo como referencia.
    const referencePlan = plans
      .filter((p) => p.isActive)
      .sort((a, b) => Number(b.priceMonthly) - Number(a.priceMonthly))[0];
    const basePrice = referencePlan ? Number(referencePlan.priceMonthly) : 0;

    const salesByPlan = Object.entries(PERIOD_MULT).map(([key, meta]) => {
      const row = tenantsByPeriodicityActive.find(
        (g) => g.planPeriodicity === key,
      );
      const count = row?._count._all ?? 0;
      // Facturación estimada del ciclo: count * basePrice * cycle
      const billingUsd = round2(count * basePrice * meta.cycle);
      return {
        periodicity: key,
        label: meta.label,
        count,
        billingUsd,
      };
    });
    // HOTFIX 2026-06-05 (bug #13): tenants con planPeriodicity=null
    // (legacy pre-4-planes 2026-06-04) caen al bucket "Sin definir"
    // para que el admin sepa cuántos tiene sin migrar.
    const unspecifiedRow = tenantsByPeriodicityActive.find(
      (g) => g.planPeriodicity == null,
    );
    if (unspecifiedRow?._count._all) {
      salesByPlan.push({
        periodicity: 'UNSPECIFIED',
        label: 'Sin definir',
        count: unspecifiedRow._count._all,
        billingUsd: round2(unspecifiedRow._count._all * basePrice),
      });
    }

    // HOTFIX 2026-06-05 (bug #18): contar TRIAL como categoría aparte.
    // Antes no aparecía en ningún KPI del dashboard, escondiendo a todos
    // los signups nuevos que aún no convirtieron.
    const trialTenants = await this.prisma.tenant.count({
      where: { status: 'TRIAL' },
    });

    return {
      comisionesGeneradasMesUsd: round2(
        Number(monthCommissions._sum.amount ?? 0),
      ),
      comisionesPendientesUsd: round2(pendingTotal),
      comisionesPagadasMesUsd: round2(
        Number(paidThisMonthAgg._sum.amountPaid ?? 0),
      ),
      proximasRenovaciones: upcomingRenewals,
      clientesActivos: activeTenants,
      clientesVencidos: expiredTenants,
      clientesTrial: trialTenants,
      salesByPlan,
      generatedAt: now,
    };
  }

  // ============================================================
  //          Fase G — Dashboard SuperAdmin v2 (2026-06-07)
  // ============================================================
  //
  // Endpoint con rango de fechas + comparación mes anterior + estado
  // clientes (5 estados) + últimos ingresos (5 tipos) + puntos para
  // mini mapa. Reemplaza al consumo del dashboard por parte del
  // /admin (Premium). El viejo `dashboardMetrics` queda para retro-
  // compatibilidad de otros consumers.

  async dashboardMetricsV2(
    user: AuthUser,
    opts: { range?: string; from?: string; to?: string } = {},
  ) {
    if (user.role !== 'SUPER_ADMIN') throw new ForbiddenException();

    // Scope por marca blanca: si la sesión "entró" a una marca (PLATFORM_OWNER
    // impersonando white-label), TODAS las métricas/series/mapa se limitan a
    // los tenants de esa marca. Sin marca activa (null) → vista global (igual
    // que antes). tenantWhere → modelos con whiteLabelId (Tenant); commWhere →
    // Commission (cuelga del tenant vía referralUse).
    const wlId = user.whiteLabelId ?? null;

    // Caché corta por (marca, rango) para que alternar rangos no recompute todo.
    const cacheKey = `${wlId ?? 'global'}::${opts.range ?? 'last-30'}::${opts.from ?? ''}::${opts.to ?? ''}`;
    const cached = this.dashCache.get(cacheKey);
    const nowMs = Date.now();
    if (cached && nowMs - cached.at < this.DASH_TTL_MS) return cached.payload;

    // isCampaignHost: excluye SIEMPRE el/los tenant(s) "de sistema" de Cuponera/
    // Living Card — no son negocios reales, no deben contar en el panel azul.
    const tenantWhere = { isCampaignHost: false, ...(wlId ? { whiteLabelId: wlId } : {}) };
    const commWhere = wlId
      ? { referralUse: { tenant: { whiteLabelId: wlId } } }
      : {};
    // P3 (PDF 2026-07-01): un Grupo Empresarial se factura/cuenta como UN solo
    // negocio (su plan), no como la suma de sus negocios miembros. Por eso:
    //  - excluimos los tenants miembros (businessGroupId != null) de las
    //    consultas de facturado/MRR/clientes nuevos, y
    //  - agregamos los grupos como unidades propias (precio canónico de su
    //    periodicidad, ya que el grupo no tiene precio individual).
    const groupWhere = wlId ? { whiteLabelId: wlId } : {};
    const notGroupMember = { businessGroupId: null };

    const now = new Date();
    const { from, to } = resolveDateRange(opts.range, opts.from, opts.to, now);
    // Mes actual y anterior para la comparación de clientes nuevos
    // (independiente del range — esa métrica siempre es mes-a-mes CALENDARIO).
    // Bug 6: anclado a meses de Bogotá, no a la hora local del server (UTC).
    const nowYmd = bogotaYmd(now);
    const { y: curY, m: curM } = parseYmd(nowYmd);
    const prevY = curM === 1 ? curY - 1 : curY;
    const prevM = curM === 1 ? 12 : curM - 1;
    const startThisMonth = bogotaDayStartUtc(fmtYmd(curY, curM, 1));
    const startLastMonth = bogotaDayStartUtc(fmtYmd(prevY, prevM, 1));
    // Último instante del mes anterior (se usa con `lte`) = inicio del actual − 1ms.
    const endLastMonth = new Date(startThisMonth.getTime() - 1);

    // FIX 2026-06-07: precios canónicos del bundle (lo que el cliente
    // realmente paga en Hotmart) — Mensual 68 / Trimestral 150 /
    // Semestral 278 / Anual 500. Antes usábamos priceMonthly * cycle
    // (el priceMonthly del Plan podía ser 99 → trimestral salía 297).
    const landingPlans = await this.settings.getLandingPlans();
    const PERIODS: Record<
      string,
      { months: number; label: string; bundlePrice: number }
    > = {
      MENSUAL: { months: 1, label: 'Mensual', bundlePrice: landingPlans.mensual.price },
      TRIMESTRAL: { months: 3, label: 'Trimestral', bundlePrice: landingPlans.trimestral.price },
      SEMESTRAL: { months: 6, label: 'Semestral', bundlePrice: landingPlans.semestral.price },
      ANUAL: { months: 12, label: 'Anual', bundlePrice: landingPlans.anual.price },
    };

    // ALTO #1 + #2 (2026-06-12): tenants con planPeriodicity=null se
    // tratan como MENSUAL (misma convención que tenants.service.list y
    // periodLabel). Antes el lookup en PERIODS devolvía undefined → el
    // tenant quedaba excluido del MRR y de billedUsd. Resultado:
    // subestimación de métricas. Helper compartido en common/plan-period.
    const normalizePeriod = normalizePlanPeriod;

    // FIX 2026-06-16 (#18): facturación REAL, no canónica. El monto que un
    // tenant aporta a facturado/MRR es lo que REALMENTE pagó en Hotmart
    // (Tenant.subscriptionPriceUsd, persistido por el webhook) y SOLO cae al
    // precio canónico del bundle cuando no hay precio real registrado.
    // Antes sumábamos siempre el canónico (68/150/278/500) → sobre-reportaba
    // a los negocios con descuento o precio legacy (ej: Semestral real $250
    // contado como $278, Mensual legacy $50 contado como $68). Misma fuente
    // de verdad que CommissionRecalcService.getCommissionBase.
    const billedAmountFor = (t: {
      planPeriodicity: string | null;
      subscriptionPriceUsd: unknown;
    }): number => {
      const real = Number(t.subscriptionPriceUsd);
      if (Number.isFinite(real) && real > 0) return real;
      return PERIODS[normalizePeriod(t.planPeriodicity)].bundlePrice;
    };

    const [
      activeTenantsForPricing,
      paidInRangeTenants,
      newCustomersCurrent,
      newCustomersPrev,
      pendingAgg,
      tenantsByStatus,
      activeTenants,
      trialTenants,
      churnedLast30,
      lastTenants,
      lastCommissions,
      mapLocations,
      groupsPaidInRange,
      newGroupsCurrent,
      newGroupsPrev,
      groupsActive,
    ] = await Promise.all([
      // Tenants ACTIVE con periodicidad y fecha de último ciclo, para
      // billing por plan + MRR + facturado en rango.
      this.prisma.tenant.findMany({
        where: {
          status: 'ACTIVE',
          OR: [
            { currentPeriodEnd: null },
            { currentPeriodEnd: { gte: now } },
          ],
          ...notGroupMember,
          ...tenantWhere,
        },
        select: {
          id: true,
          planPeriodicity: true,
          currentPeriodEnd: true,
          createdAt: true,
          subscriptionPriceUsd: true,
          lastChargeAt: true,
        },
      }),
      // PDF 752 #6 (2026-06-26): "monto facturado" del rango = pagos REALES.
      // lastChargeAt es la fecha del cobro real (webhook Hotmart approved_date,
      // o activación manual). Tomamos cualquier negocio que cobró en [from,to]
      // SIN importar su status actual (un negocio que pagó este mes y luego se
      // suspendió igual facturó). Misma lógica para todas las marcas (scope wl).
      this.prisma.tenant.findMany({
        where: {
          lastChargeAt: { gte: from, lte: to },
          ...notGroupMember,
          ...tenantWhere,
        },
        select: {
          id: true,
          planPeriodicity: true,
          subscriptionPriceUsd: true,
        },
      }),
      // FIX 2026-06-07: clientes nuevos = solo ACTIVE creados en el
      // rango. Antes contaba TRIAL también.
      this.prisma.tenant.count({
        where: {
          status: 'ACTIVE',
          createdAt: { gte: startThisMonth, lte: now },
          ...notGroupMember,
          ...tenantWhere,
        },
      }),
      this.prisma.tenant.count({
        where: {
          status: 'ACTIVE',
          createdAt: { gte: startLastMonth, lte: endLastMonth },
          ...notGroupMember,
          ...tenantWhere,
        },
      }),
      // FIX 2026-06-16 (#14/#37): "pendiente por pagar a afiliados" =
      // (PENDING + APPROVED) con amount − amountPaid. Antes { not: REJECTED }
      // metía RETAINED (congelada, fuera de totales) y PAID en el pool →
      // divergía de Referidos/Comisiones. Definición canónica única.
      this.prisma.commission.aggregate({
        where: { status: { in: ['PENDING', 'APPROVED'] }, ...commWhere },
        _sum: { amount: true, amountPaid: true },
      }),
      this.prisma.tenant.groupBy({
        by: ['status'],
        // #13: excluye borrados para que los buckets de "Estado de clientes"
        // no se solapen con "Cancelados" (deletedAt != null).
        where: { deletedAt: null, ...tenantWhere },
        _count: { _all: true },
      }),
      this.prisma.tenant.count({
        where: {
          status: 'ACTIVE',
          OR: [
            { currentPeriodEnd: null },
            { currentPeriodEnd: { gte: now } },
          ],
          ...tenantWhere,
        },
      }),
      this.prisma.tenant.count({ where: { status: 'TRIAL', ...tenantWhere } }),
      // Cancellation rate: SUSPENDED total (Tenant no tiene suspendedAt;
      // aproximamos a "actualmente cancelados" sobre activos).
      this.prisma.tenant.count({
        where: { status: 'SUSPENDED', ...tenantWhere },
      }),
      // Últimos 10 tenants para "Últimos ingresos".
      this.prisma.tenant.findMany({
        where: tenantWhere,
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: {
          id: true,
          brandName: true,
          status: true,
          planPeriodicity: true,
          createdAt: true,
          trialStartedAt: true,
          currentPeriodEnd: true,
        },
      }),
      this.prisma.commission.findMany({
        where: commWhere,
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: {
          id: true,
          amount: true,
          createdAt: true,
          status: true,
          referralUse: {
            select: {
              tenant: { select: { id: true, brandName: true } },
            },
          },
          recipientCode: { select: { ownerName: true, role: true } },
        },
      }),
      this.prisma.location.findMany({
        where: {
          isActive: true,
          tenant: { status: 'ACTIVE', ...tenantWhere },
        },
        take: 200,
        select: {
          id: true,
          latitude: true,
          longitude: true,
          name: true,
          address: true,
          tenant: {
            select: {
              id: true,
              brandName: true,
              status: true,
              planPeriodicity: true,
            },
          },
        },
      }),
      // P3: Grupos Empresariales como unidades de facturación propias.
      // Cobrados en el rango (fecha de cobro real del grupo).
      this.prisma.businessGroup.findMany({
        where: {
          deletedAt: null,
          lastChargeAt: { gte: from, lte: to },
          ...groupWhere,
        },
        select: { planPeriodicity: true, priceUsd: true },
      }),
      // Grupos nuevos (ACTIVE) este mes / mes anterior → cuentan como clientes.
      this.prisma.businessGroup.count({
        where: {
          deletedAt: null,
          status: 'ACTIVE',
          createdAt: { gte: startThisMonth, lte: now },
          ...groupWhere,
        },
      }),
      this.prisma.businessGroup.count({
        where: {
          deletedAt: null,
          status: 'ACTIVE',
          createdAt: { gte: startLastMonth, lte: endLastMonth },
          ...groupWhere,
        },
      }),
      // Grupos ACTIVE (para MRR + serie mensual), con su periodicidad y alta.
      this.prisma.businessGroup.findMany({
        where: { deletedAt: null, status: 'ACTIVE', ...groupWhere },
        select: { planPeriodicity: true, createdAt: true, priceUsd: true },
      }),
    ]);

    // FIX 2026-06-07: MRR = suma de equivalencia mensual real del bundle
    // por tenant ACTIVE. Mensual aporta 68; Trimestral 150/3=50;
    // Semestral 278/6=46.33; Anual 500/12=41.67. Antes sumábamos
    // priceMonthly (incorrecto: daba 99 × N).
    // ALTO #1 (2026-06-12): tenants con planPeriodicity=null ahora se
    // tratan como MENSUAL en vez de excluirse → métricas reales.
    const mrrUsd = round2(
      activeTenantsForPricing.reduce((s, t) => {
        const period = PERIODS[normalizePeriod(t.planPeriodicity)];
        // FIX 2026-06-16 (#18): normaliza el pago REAL del ciclo a mensual.
        return s + billedAmountFor(t) / period.months;
      }, 0) +
        // P3: cada Grupo Empresarial ACTIVE aporta su equivalencia mensual
        // (precio canónico de su periodicidad / meses), como 1 unidad.
        groupsActive.reduce((s, g) => {
          const period = PERIODS[normalizePeriod(g.planPeriodicity)];
          const gp = Number(g.priceUsd) > 0 ? Number(g.priceUsd) : period.bundlePrice;
          return s + gp / period.months;
        }, 0),
    );

    // #16 (2026-06-16): se eliminó la métrica "Conversión Trial → Cliente".

    const cancellationRate = activeTenants
      ? Math.round((churnedLast30 / activeTenants) * 1000) / 10
      : 0;

    // FIX 2026-06-07: billedUsd del RANGO. "Pagó en el rango" ≈ tiene
    // currentPeriodEnd - bundleMonths dentro del rango. Sumamos
    // bundlePrice por cada match.
    //
    // ALTO #2 (2026-06-12): tenants con currentPeriodEnd null ahora
    // usan createdAt como aproximación (asumiendo que el pago inicial
    // = createdAt). Antes se excluían silenciosamente → métricas
    // sub-estimadas. planPeriodicity null → MENSUAL.
    //
    // FIX 2026-06-16: billedByPlan se calcula EN ESTA MISMA PASADA, con el
    // MISMO filtro de rango y el MISMO normalizePeriod (null→MENSUAL). Antes
    // billedByPlan contaba TODOS los tenants ACTIVE sin filtrar por rango y
    // con `=== key` crudo (dropeaba planPeriodicity=null), así que el total
    // (date-filtered) no cuadraba con la suma de los buckets. Ahora el
    // total es, por construcción, la suma exacta de los 4 buckets.
    // Bug 1 (auditoría facturación 2026-08-17): se separa el COBRADO REAL
    // (negocios/grupos con lastChargeAt en el rango) del PROYECTADO (negocios
    // ACTIVE sin lastChargeAt cuyo cobro se ESTIMA). Antes ambos se sumaban bajo
    // "MONTO FACTURADO / Cobrado", mezclando caja real con proyección. `groups`
    // cuenta cuántas unidades del bucket son Grupos Empresariales (Bug 5).
    const mkAcc = (): Record<
      string,
      { count: number; amount: number; groups: number }
    > => ({
      MENSUAL: { count: 0, amount: 0, groups: 0 },
      TRIMESTRAL: { count: 0, amount: 0, groups: 0 },
      SEMESTRAL: { count: 0, amount: 0, groups: 0 },
      ANUAL: { count: 0, amount: 0, groups: 0 },
    });
    const billedAcc = mkAcc(); // COBRADO real
    const estimatedAcc = mkAcc(); // PROYECTADO (sin cobro registrado)
    let billedUsd = 0;
    let estimatedUsd = 0;
    // PDF 752 #6 (2026-06-26): el "monto facturado" del rango ahora se basa en
    // la FECHA DE COBRO REAL (lastChargeAt, sincronizada con Hotmart) en vez de
    // una estimación currentPeriodEnd−meses. Cada negocio que cobró en [from,to]
    // suma su precio real (subscriptionPriceUsd ?? canónico), agrupado por
    // periodicidad. Incluye negocios que luego se suspendieron (igual facturaron)
    // y hace que día/semana/mes/trimestre/año cuadren igual para todas las marcas.
    for (const t of paidInRangeTenants) {
      const key = normalizePeriod(t.planPeriodicity);
      const amount = billedAmountFor(t);
      billedUsd += amount;
      billedAcc[key].count += 1;
      billedAcc[key].amount += amount;
    }
    // PROYECTADO (antes "FALLBACK legacy"): negocios ACTIVE SIN lastChargeAt.
    // Su fecha de cobro se ESTIMA (currentPeriodEnd−meses, o createdAt). NO es
    // caja real → va a estimatedAcc/estimatedUsd, nunca al "Cobrado" (Bug 1).
    // Un cobro/activación real que setee lastChargeAt vuelve esta rama inerte.
    for (const t of activeTenantsForPricing) {
      if (t.lastChargeAt) continue; // ya contado por paidInRangeTenants si cae en rango
      const key = normalizePeriod(t.planPeriodicity);
      const period = PERIODS[key];
      const cpe = t.currentPeriodEnd ?? null;
      const lastPaymentApprox = cpe
        ? new Date(cpe)
        : t.createdAt
          ? new Date(t.createdAt)
          : null;
      if (cpe && lastPaymentApprox) {
        lastPaymentApprox.setDate(1);
        lastPaymentApprox.setMonth(lastPaymentApprox.getMonth() - period.months);
      }
      if (!lastPaymentApprox) continue;
      if (
        lastPaymentApprox.getTime() >= from.getTime() &&
        lastPaymentApprox.getTime() <= to.getTime()
      ) {
        const amount = billedAmountFor(t);
        estimatedUsd += amount;
        estimatedAcc[key].count += 1;
        estimatedAcc[key].amount += amount;
      }
    }
    // P3: cada Grupo Empresarial cobrado en el rango suma como 1 negocio en la
    // tarjeta de su plan (precio canónico de la periodicidad del grupo).
    for (const g of groupsPaidInRange) {
      const key = normalizePeriod(g.planPeriodicity);
      // Precio real del grupo (priceUsd, ej: 3×$50=$150) o canónico si null.
      const amount =
        Number(g.priceUsd) > 0 ? Number(g.priceUsd) : PERIODS[key].bundlePrice;
      billedUsd += amount;
      billedAcc[key].count += 1;
      billedAcc[key].amount += amount;
      billedAcc[key].groups += 1; // Bug 5: 1 unidad = 1 grupo (no negocio individual)
    }
    billedUsd = round2(billedUsd);
    estimatedUsd = round2(estimatedUsd);

    const billedByPlan = Object.entries(PERIODS).map(([key, meta]) => ({
      periodicity: key,
      label: meta.label,
      count: billedAcc[key].count, // negocios + grupos con COBRO REAL en el rango
      businessCount: billedAcc[key].count - billedAcc[key].groups, // Bug 5
      groupCount: billedAcc[key].groups, // Bug 5
      billingUsd: round2(billedAcc[key].amount), // COBRADO real (caja)
      estimatedCount: estimatedAcc[key].count, // Bug 1: proyectado, sin cobro real
      estimatedUsd: round2(estimatedAcc[key].amount),
    }));
    const estimatedCount =
      estimatedAcc.MENSUAL.count +
      estimatedAcc.TRIMESTRAL.count +
      estimatedAcc.SEMESTRAL.count +
      estimatedAcc.ANUAL.count;
    const billedGroups =
      billedAcc.MENSUAL.groups +
      billedAcc.TRIMESTRAL.groups +
      billedAcc.SEMESTRAL.groups +
      billedAcc.ANUAL.groups;

    // ============================================================
    // SERIE MENSUAL REAL (#13/#19, 2026-06-16) — reemplaza los charts
    // simulados del front. Últimos 6 meses con datos REALES:
    //  - mrrUsd: MRR estimado al cierre de cada mes = Σ equivalencia
    //    mensual (precio real ?? canónico / meses) de los tenants ACTIVE
    //    creados on/before ese mes. Es una aproximación (no hay snapshots
    //    históricos de status → no descuenta churn pasado) pero deriva de
    //    datos reales, no de una simulación.
    //  - commPaidUsd: Σ amountPaid de comisiones con paidAt en el mes.
    //  - commPendingUsd: Σ (amount − amountPaid) de comisiones creadas en
    //    el mes que siguen PENDING/APPROVED.
    // ============================================================
    const monthsBack = 6;
    const firstMonthStart = new Date(
      now.getFullYear(),
      now.getMonth() - (monthsBack - 1),
      1,
    );
    const [allTenantsForMrr, commForSeries, pastDueCount, cancelledCount] = await Promise.all([
      this.prisma.tenant.findMany({
        where: { deletedAt: null, status: 'ACTIVE', ...notGroupMember, ...tenantWhere },
        select: {
          createdAt: true,
          planPeriodicity: true,
          subscriptionPriceUsd: true,
        },
      }),
      this.prisma.commission.findMany({
        where: {
          status: { not: 'REJECTED' },
          OR: [
            { createdAt: { gte: firstMonthStart } },
            { paidAt: { gte: firstMonthStart } },
          ],
          ...commWhere,
        },
        select: {
          amount: true,
          amountPaid: true,
          status: true,
          createdAt: true,
          paidAt: true,
        },
      }),
      // #13 (2026-06-16): "Esperando pago" REAL = ACTIVE con pagos fallidos
      // (past-due derivado, igual que billing.service.getStatus). Antes el
      // dashboard buscaba status 'PAYING' que NO existe en el enum → 0 fijo.
      this.prisma.tenant.count({
        where: {
          deletedAt: null,
          status: 'ACTIVE',
          failedPaymentCount: { gt: 0 },
          ...tenantWhere,
        },
      }),
      // #13: "Cancelados" REAL = negocios borrados (soft-delete). Antes
      // buscaba status 'CANCELLED' que tampoco existe → 0 fijo.
      this.prisma.tenant.count({
        where: { deletedAt: { not: null }, ...tenantWhere },
      }),
    ]);

    const monthLabels = [
      'Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun',
      'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic',
    ];
    const monthlySeries: Array<{
      label: string;
      mrrUsd: number;
      commPaidUsd: number;
      commPendingUsd: number;
    }> = [];
    for (let i = monthsBack - 1; i >= 0; i--) {
      const mStart = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const mEnd = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);
      // MRR al cierre del mes: tenants ACTIVE creados antes del fin de mes.
      let mrr = 0;
      for (const t of allTenantsForMrr) {
        if (new Date(t.createdAt).getTime() >= mEnd.getTime()) continue;
        const period = PERIODS[normalizePeriod(t.planPeriodicity)];
        mrr += billedAmountFor(t) / period.months;
      }
      // P3: grupos ACTIVE creados on/before el mes → 1 unidad c/u (priceUsd o canónico).
      for (const g of groupsActive) {
        if (new Date(g.createdAt).getTime() >= mEnd.getTime()) continue;
        const period = PERIODS[normalizePeriod(g.planPeriodicity)];
        const gp = Number(g.priceUsd) > 0 ? Number(g.priceUsd) : period.bundlePrice;
        mrr += gp / period.months;
      }
      // Comisiones del mes (reales).
      let paid = 0;
      let pending = 0;
      for (const c of commForSeries) {
        if (
          c.paidAt &&
          new Date(c.paidAt).getTime() >= mStart.getTime() &&
          new Date(c.paidAt).getTime() < mEnd.getTime()
        ) {
          paid += Number(c.amountPaid ?? 0);
        }
        const created = new Date(c.createdAt).getTime();
        if (
          created >= mStart.getTime() &&
          created < mEnd.getTime() &&
          (c.status === 'PENDING' || c.status === 'APPROVED')
        ) {
          pending += Math.max(0, Number(c.amount ?? 0) - Number(c.amountPaid ?? 0));
        }
      }
      monthlySeries.push({
        label: monthLabels[mStart.getMonth()],
        mrrUsd: round2(mrr),
        commPaidUsd: round2(paid),
        commPendingUsd: round2(pending),
      });
    }

    const pendingCommissionsUsd = round2(
      Math.max(
        0,
        Number(pendingAgg._sum.amount ?? 0) -
          Number(pendingAgg._sum.amountPaid ?? 0),
      ),
    );

    const statusMap = Object.fromEntries(
      tenantsByStatus.map((r) => [r.status, r._count._all]),
    );
    // #13 (2026-06-16): buckets REALES y no solapados (suman el total de
    // tenants). "active" excluye los past-due (que van a awaitingPayment);
    // "cancelled" = borrados. Antes awaitingPayment/cancelled buscaban
    // status inexistentes (PAYING/CANCELLED) → siempre 0.
    const activeNotDeleted = Number(statusMap['ACTIVE'] ?? 0);
    const clientStatus = {
      active: Math.max(0, activeNotDeleted - pastDueCount),
      trial: Number(statusMap['TRIAL'] ?? 0),
      awaitingPayment: pastDueCount,
      suspended: Number(statusMap['SUSPENDED'] ?? 0),
      cancelled: cancelledCount,
    };

    // P3: clientes nuevos incluye Grupos Empresariales como 1 negocio c/u.
    const newCustCurrent = newCustomersCurrent + newGroupsCurrent;
    const newCustPrev = newCustomersPrev + newGroupsPrev;
    // Variación clientes nuevos mes a mes.
    const deltaPct = newCustPrev
      ? Math.round(
          ((newCustCurrent - newCustPrev) / newCustPrev) * 1000,
        ) / 10
      : null;

    // Últimos ingresos — merge de eventos del rango ordenados desc.
    type IncomeEvent = {
      kind: 'new_tenant' | 'trial_started' | 'trial_converted' | 'commission';
      label: string;
      tenantId?: string;
      tenantName?: string;
      when: Date;
      amountUsd?: number;
      meta?: string;
    };
    const events: IncomeEvent[] = [];
    for (const t of lastTenants) {
      if (t.status === 'TRIAL') {
        events.push({
          kind: 'trial_started',
          label: 'Trial iniciado',
          tenantId: t.id,
          tenantName: t.brandName,
          when: t.createdAt,
          meta: t.planPeriodicity ?? undefined,
        });
      } else if (t.status === 'ACTIVE') {
        events.push({
          kind: t.trialStartedAt ? 'trial_converted' : 'new_tenant',
          label: t.trialStartedAt
            ? 'Trial → Cliente'
            : 'Nuevo negocio',
          tenantId: t.id,
          tenantName: t.brandName,
          when: t.createdAt,
          meta: t.planPeriodicity ?? undefined,
        });
      }
    }
    for (const c of lastCommissions) {
      events.push({
        kind: 'commission',
        label: 'Comisión generada',
        tenantId: c.referralUse?.tenant?.id,
        tenantName: c.referralUse?.tenant?.brandName ?? '—',
        when: c.createdAt,
        amountUsd: Number(c.amount),
        meta:
          c.recipientCode?.ownerName && c.recipientCode?.role
            ? `${c.recipientCode.ownerName} (${c.recipientCode.role})`
            : undefined,
      });
    }
    events.sort((a, b) => b.when.getTime() - a.when.getTime());
    const recentIncome = events.slice(0, 15);

    const payload = {
      range: {
        kind: opts.range ?? 'last-30',
        from,
        to,
      },
      banner: {
        billedUsd, // COBRADO real (solo negocios/grupos con lastChargeAt en rango)
        estimatedUsd, // Bug 1: PROYECTADO (estimado, sin cobro registrado) — aparte
        estimatedCount,
        billedGroups, // Bug 5: cuántas unidades del facturado son Grupos
        billedByPlan,
        newCustomers: {
          currentMonth: newCustCurrent,
          lastMonth: newCustPrev,
          deltaPct,
        },
      },
      kpis: {
        mrrUsd,
        cancellationRate,
        pendingCommissionsUsd,
      },
      monthlySeries,
      clientStatus,
      recentIncome,
      mapPoints: mapLocations
        .filter(
          (l) =>
            l.latitude !== null &&
            l.longitude !== null &&
            Number(l.latitude) !== 0 &&
            Number(l.longitude) !== 0,
        )
        .map((l) => ({
          id: l.id,
          tenantId: l.tenant.id,
          brandName: l.tenant.brandName,
          status: l.tenant.status,
          planPeriodicity: l.tenant.planPeriodicity,
          latitude: Number(l.latitude),
          longitude: Number(l.longitude),
          locationName: l.name,
          address: l.address,
        })),
      generatedAt: now,
    };

    this.dashCache.set(cacheKey, { at: nowMs, payload });
    return payload;
  }

  // ============================================================
  //   "VER EMPRESAS" (P2 PDF 2026-07-02) — auditoría del facturado
  // ============================================================
  //
  // Devuelve la lista EXACTA de negocios (y grupos) que componen el "Monto
  // facturado" del rango — misma lógica que dashboardMetricsV2 (mismo
  // billedAmountFor + fallback legacy + grupos como 1 unidad). Sirve para
  // auditar qué se está contando (incluido verificar el grupo empresarial).
  async billedCompanies(
    user: AuthUser,
    opts: { range?: string; from?: string; to?: string } = {},
  ) {
    if (user.role !== 'SUPER_ADMIN') throw new ForbiddenException();
    const wlId = user.whiteLabelId ?? null;
    // isCampaignHost: excluye el tenant de sistema de Cuponera del facturado.
    const tenantWhere = { isCampaignHost: false, ...(wlId ? { whiteLabelId: wlId } : {}) };
    const groupWhere = wlId ? { whiteLabelId: wlId } : {};
    const now = new Date();
    const { from, to } = resolveDateRange(opts.range, opts.from, opts.to, now);

    const landingPlans = await this.settings.getLandingPlans();
    const PERIODS: Record<string, { months: number; label: string; bundlePrice: number }> = {
      MENSUAL: { months: 1, label: 'Mensual', bundlePrice: landingPlans.mensual.price },
      TRIMESTRAL: { months: 3, label: 'Trimestral', bundlePrice: landingPlans.trimestral.price },
      SEMESTRAL: { months: 6, label: 'Semestral', bundlePrice: landingPlans.semestral.price },
      ANUAL: { months: 12, label: 'Anual', bundlePrice: landingPlans.anual.price },
    };
    const normalizePeriod = normalizePlanPeriod;
    const billedAmountFor = (t: { planPeriodicity: string | null; subscriptionPriceUsd: unknown }) => {
      const real = Number(t.subscriptionPriceUsd);
      if (Number.isFinite(real) && real > 0) return real;
      return PERIODS[normalizePeriod(t.planPeriodicity)].bundlePrice;
    };

    const [paidTenants, activeNoCharge, groups] = await Promise.all([
      this.prisma.tenant.findMany({
        where: { businessGroupId: null, lastChargeAt: { gte: from, lte: to }, ...tenantWhere },
        select: { id: true, brandName: true, planPeriodicity: true, subscriptionPriceUsd: true, lastChargeAt: true, status: true },
      }),
      this.prisma.tenant.findMany({
        where: {
          status: 'ACTIVE',
          businessGroupId: null,
          lastChargeAt: null,
          OR: [{ currentPeriodEnd: null }, { currentPeriodEnd: { gte: now } }],
          ...tenantWhere,
        },
        select: { id: true, brandName: true, planPeriodicity: true, subscriptionPriceUsd: true, currentPeriodEnd: true, createdAt: true },
      }),
      this.prisma.businessGroup.findMany({
        where: { deletedAt: null, lastChargeAt: { gte: from, lte: to }, ...groupWhere },
        select: { id: true, name: true, planPeriodicity: true, priceUsd: true, lastChargeAt: true },
      }),
    ]);

    type Row = {
      kind: 'business' | 'group';
      id: string;
      name: string;
      plan: string;
      amountUsd: number;
      paidAt: Date | null;
      status: string;
      estimated?: boolean;
    };
    const rows: Row[] = [];
    for (const t of paidTenants) {
      rows.push({
        kind: 'business', id: t.id, name: t.brandName,
        plan: normalizePeriod(t.planPeriodicity), amountUsd: round2(billedAmountFor(t)),
        paidAt: t.lastChargeAt, status: t.status,
      });
    }
    // Fallback legacy (mismo criterio que el panel): ACTIVE sin lastChargeAt
    // cuyo pago estimado (currentPeriodEnd − meses, o createdAt) cae en el rango.
    for (const t of activeNoCharge) {
      const key = normalizePeriod(t.planPeriodicity);
      const period = PERIODS[key];
      const cpe = t.currentPeriodEnd ?? null;
      const approx = cpe ? new Date(cpe) : t.createdAt ? new Date(t.createdAt) : null;
      if (cpe && approx) {
        approx.setDate(1);
        approx.setMonth(approx.getMonth() - period.months);
      }
      if (!approx) continue;
      if (approx.getTime() >= from.getTime() && approx.getTime() <= to.getTime()) {
        rows.push({
          kind: 'business', id: t.id, name: t.brandName, plan: key,
          amountUsd: round2(billedAmountFor(t)), paidAt: null, status: 'ACTIVE', estimated: true,
        });
      }
    }
    for (const g of groups) {
      const key = normalizePeriod(g.planPeriodicity);
      const amount = Number(g.priceUsd) > 0 ? Number(g.priceUsd) : PERIODS[key].bundlePrice;
      rows.push({
        kind: 'group', id: g.id, name: g.name, plan: key,
        amountUsd: round2(amount), paidAt: g.lastChargeAt, status: '—',
      });
    }
    rows.sort((a, b) => (b.paidAt?.getTime() ?? 0) - (a.paidAt?.getTime() ?? 0));
    const total = round2(rows.reduce((s, r) => s + r.amountUsd, 0));
    // Bug 1 (auditoría 2026-08-17): desglose para el pie del modal — el "Cobrado"
    // real (filas con fecha de pago) NO se mezcla con lo estimado (sin cobro).
    const realRows = rows.filter((r) => !r.estimated);
    const estimatedRows = rows.filter((r) => r.estimated);
    const realTotal = round2(realRows.reduce((s, r) => s + r.amountUsd, 0));
    const estimatedTotal = round2(estimatedRows.reduce((s, r) => s + r.amountUsd, 0));
    return {
      range: { kind: opts.range ?? 'last-30', from, to },
      total,
      count: rows.length,
      // Desglose Cobrado vs Estimado (Bug 1).
      realTotal,
      realCount: realRows.length,
      estimatedTotal,
      estimatedCount: estimatedRows.length,
      companies: rows,
    };
  }

  // ============================================================
  //            CRÉDITOS POR MARCA (Fase 3 · #6 / #7)
  // ============================================================
  //
  // El admin de una marca blanca (SUPER_ADMIN con whiteLabelId) ve y
  // gestiona los créditos de SU marca desde /admin/credits. 1 crédito =
  // 30 días de servicio para un negocio. La infra de créditos vive en
  // WhiteLabel + CreditTransaction + HotmartCreditLink (gestionada por el
  // PLATFORM_OWNER en /superadmin/creditos); acá sólo exponemos la vista
  // brand-scoped + la activación manual (consume 1 crédito).
  //
  // Diseño ADITIVO: NO toca activatePurchase ni el cron de renovaciones.
  // La activación manual replica el débito race-safe del cron.

  private static readonly CYCLE_DAYS = 30;

  /** Resuelve la marca del admin actual. null = Clubify / PLATFORM_OWNER
   *  (scope global) → no aplica panel de créditos por marca. */
  private requireWhiteLabelId(user: AuthUser): string {
    if (user.role !== 'SUPER_ADMIN' && user.role !== 'PLATFORM_OWNER') {
      throw new ForbiddenException();
    }
    if (!user.whiteLabelId) {
      // Admin global (Clubify) — no tiene una marca propia con créditos.
      throw new ForbiddenException(
        'Esta sección es para administradores de una marca blanca.',
      );
    }
    return user.whiteLabelId;
  }

  /**
   * Resumen de créditos de la marca del admin: disponibles / usados /
   * comprometidos + links de compra (Hotmart) + historial reciente.
   * Las marcas con créditos ilimitados no necesitan esta sección
   * (`unlimited:true`); el front la oculta.
   */
  async myCredits(user: AuthUser) {
    const wlId = this.requireWhiteLabelId(user);
    const wl = await this.prisma.whiteLabel.findUnique({
      where: { id: wlId },
      select: {
        id: true,
        name: true,
        slug: true,
        // Dominios de la marca → el link de login que se comparte por WhatsApp/
        // email al crear un negocio usa el dominio del PANEL de la marca
        // (app.selleala.com), no soyclubify.com.
        appDomain: true,
        domain: true,
        creditsAvailable: true,
        creditsCommitted: true,
        creditsUsed: true,
        creditsUnlimited: true,
        planPeriodicities: true,
      },
    });
    if (!wl) throw new NotFoundException('Marca no encontrada');

    const [history, buyLinks, pendingCount] = await Promise.all([
      this.prisma.creditTransaction.findMany({
        where: { whiteLabelId: wlId },
        orderBy: { createdAt: 'desc' },
        take: 30,
        select: {
          id: true,
          type: true,
          amount: true,
          note: true,
          tenantId: true,
          createdAt: true,
          refundedAt: true,
        },
      }),
      // Links de compra públicos (los mismos que el PLATFORM_OWNER
      // configura). Sólo activos, ordenados.
      this.prisma.hotmartCreditLink.findMany({
        where: { isActive: true },
        orderBy: [{ position: 'asc' }, { credits: 'asc' }],
        select: {
          id: true,
          credits: true,
          label: true,
          url: true,
          price: true,
          currency: true,
        },
      }),
      this.countPendingTenants(wlId),
    ]);

    return {
      whiteLabel: {
        id: wl.id,
        name: wl.name,
        slug: wl.slug,
        // Panel (app.selleala.com) preferido; público (selleala.com) de respaldo.
        appDomain: wl.appDomain ?? null,
        domain: wl.domain ?? null,
      },
      unlimited: wl.creditsUnlimited,
      // Periodicidades que ofrece la marca (form "Nuevo negocio" las usa).
      planPeriodicities: wl.planPeriodicities ?? [],
      available: wl.creditsAvailable,
      committed: wl.creditsCommitted,
      used: wl.creditsUsed,
      pendingTenants: pendingCount,
      // PDF 1256 · créditos: inyectamos el token `src=wl_<marca>` en cada link de
      // compra. Así, cuando ESTA marca compra desde su panel, el webhook Hotmart
      // trae tracking.source=wl_<id> y acredita a la marca correcta sin depender
      // del correo del comprador (evita que caiga como UNASSIGNED). Ver
      // hotmart.service tryHandleCreditPurchase (resolución por token = 1ª prioridad).
      buyLinks: buyLinks.map((l) => ({
        ...l,
        url: withWlToken(l.url, wlId),
        price: l.price == null ? null : Number(l.price),
      })),
      history,
    };
  }

  /** WHERE de negocios "pendientes de activación" de una marca: TRIAL
   *  vencido, periodo vencido, o suspendidos. Compartido entre count y
   *  list para que el badge y la lista cuadren. */
  private pendingTenantsWhere(wlId: string) {
    const now = new Date();
    return {
      whiteLabelId: wlId,
      OR: [
        { status: 'SUSPENDED' as const },
        { status: 'TRIAL' as const, trialEndsAt: { lt: now } },
        { status: 'ACTIVE' as const, currentPeriodEnd: { lt: now } },
      ],
    };
  }

  private countPendingTenants(wlId: string) {
    return this.prisma.tenant.count({ where: this.pendingTenantsWhere(wlId) });
  }

  /**
   * Lista los negocios de la marca pendientes de activación/renovación.
   * El admin los activa manualmente consumiendo 1 crédito.
   */
  async listPendingTenants(user: AuthUser) {
    const wlId = this.requireWhiteLabelId(user);
    const now = new Date();
    const tenants = await this.prisma.tenant.findMany({
      where: this.pendingTenantsWhere(wlId),
      orderBy: { createdAt: 'desc' },
      take: 200,
      select: {
        id: true,
        brandName: true,
        slug: true,
        status: true,
        trialEndsAt: true,
        currentPeriodEnd: true,
        planPeriodicity: true,
        createdAt: true,
      },
    });
    return tenants.map((t) => {
      const ref = t.status === 'TRIAL' ? t.trialEndsAt : t.currentPeriodEnd;
      const overdueDays =
        ref && ref < now
          ? Math.floor(
              (now.getTime() - ref.getTime()) / (24 * 60 * 60 * 1000),
            )
          : 0;
      return {
        id: t.id,
        brandName: t.brandName,
        slug: t.slug,
        status: t.status,
        reason:
          t.status === 'SUSPENDED'
            ? 'Suspendido'
            : t.status === 'TRIAL'
              ? 'Prueba vencida'
              : 'Periodo vencido',
        overdueDays,
        createdAt: t.createdAt,
      };
    });
  }

  /**
   * Activa manualmente un negocio de la marca consumiendo 1 crédito:
   * pasa a ACTIVE + extiende currentPeriodEnd 30 días (desde hoy o desde
   * el fin de periodo si aún es futuro). Replica el débito race-safe del
   * cron de renovaciones. Marcas ilimitadas activan sin consumir.
   *
   * ADITIVO: no toca activatePurchase (Hotmart) — esto es activación
   * operativa por créditos, no una compra.
   */
  async activateTenant(user: AuthUser, tenantId: string) {
    const wlId = this.requireWhiteLabelId(user);
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: {
        id: true,
        brandName: true,
        whiteLabelId: true,
        status: true,
        currentPeriodEnd: true,
        businessType: true,
        infolinkTier: true,
        planPeriodicity: true,
      },
    });
    if (!tenant) throw new NotFoundException('Negocio no encontrado');
    // Aislamiento estricto: sólo negocios de la propia marca.
    if (tenant.whiteLabelId !== wlId) {
      throw new ForbiddenException('Este negocio no pertenece a tu marca.');
    }

    const wl = await this.prisma.whiteLabel.findUnique({
      where: { id: wlId },
      select: {
        id: true,
        name: true,
        status: true,
        creditsAvailable: true,
        creditsUnlimited: true,
      },
    });
    if (!wl) throw new NotFoundException('Marca no encontrada');
    if (wl.status === 'SUSPENDED') {
      throw new ForbiddenException('Tu marca está suspendida. Contacta soporte.');
    }

    const now = new Date();
    const base =
      tenant.currentPeriodEnd && tenant.currentPeriodEnd > now
        ? tenant.currentPeriodEnd
        : now;
    // Extiende por la periodicidad del plan (Anual = +12 meses), no +30 fijos,
    // y cobra el ciclo completo según el tipo de negocio (InfoLink anual = 3).
    const newPeriodEnd = addPlanPeriod(base, tenant.planPeriodicity);
    const cost = cycleCreditCostForTenant(tenant.businessType, tenant.infolinkTier, tenant.planPeriodicity);
    const months = bundleMonths(tenant.planPeriodicity);

    // Marca ilimitada: activa sin consumir crédito ni crear transacción.
    if (wl.creditsUnlimited) {
      await this.prisma.tenant.update({
        where: { id: tenant.id },
        data: { status: 'ACTIVE', currentPeriodEnd: newPeriodEnd, lastChargeAt: now },
      });
      return {
        ok: true,
        consumed: 0,
        creditsAvailable: wl.creditsAvailable,
        currentPeriodEnd: newPeriodEnd,
      };
    }

    // Débito race-safe: sólo decrementa si hay >= cost créditos.
    const debit = await this.prisma.whiteLabel.updateMany({
      where: { id: wlId, creditsAvailable: { gte: cost } },
      data: {
        creditsAvailable: { decrement: cost },
        creditsUsed: { increment: cost },
      },
    });
    if (debit.count === 0) {
      throw new ForbiddenException(
        'No tienes créditos disponibles. Compra un pack para activar este negocio.',
      );
    }

    try {
      await this.prisma.tenant.update({
        where: { id: tenant.id },
        data: { status: 'ACTIVE', currentPeriodEnd: newPeriodEnd, lastChargeAt: now },
      });
      await this.prisma.creditTransaction.create({
        data: {
          whiteLabelId: wlId,
          type: 'CONSUME',
          amount: -cost,
          tenantId: tenant.id,
          note: `Activación manual · ${tenant.brandName} · +${months}m · ${cost} créd`,
        },
      });
    } catch (e) {
      // Rollback del crédito si la activación falló.
      await this.prisma.whiteLabel.update({
        where: { id: wlId },
        data: {
          creditsAvailable: { increment: cost },
          creditsUsed: { decrement: cost },
        },
      });
      throw e;
    }

    const after = await this.prisma.whiteLabel.findUnique({
      where: { id: wlId },
      select: { creditsAvailable: true },
    });
    const available = after?.creditsAvailable ?? wl.creditsAvailable - cost;
    // Notificaciones a la marca (best-effort): saldo bajo + recálculo de
    // pendientes (este activación pudo haber vaciado la bandeja).
    await this.wlNotifications.onCreditsConsumed(wlId, available).catch(() => null);
    const pendingNow = await this.countPendingTenants(wlId).catch(() => 0);
    await this.wlNotifications.onPendingClients(wlId, pendingNow).catch(() => null);
    return {
      ok: true,
      consumed: cost,
      creditsAvailable: available,
      currentPeriodEnd: newPeriodEnd,
    };
  }

  /**
   * Reembolso MANUAL de un movimiento CONSUME dentro de la ventana de 5 días:
   * devuelve el crédito al pool de la marca y SUSPENDE el negocio (le sacás el
   * crédito que le pagaba el servicio → deja de estar activo). Race-safe +
   * idempotente; pasados los 5 días rechaza. Aislado a la marca del admin.
   */
  async refundCredit(user: AuthUser, transactionId: string) {
    const wlId = this.requireWhiteLabelId(user);
    const tx = await this.prisma.creditTransaction.findUnique({
      where: { id: transactionId },
      select: {
        id: true,
        whiteLabelId: true,
        type: true,
        amount: true,
        tenantId: true,
        createdAt: true,
        refundedAt: true,
      },
    });
    if (!tx || tx.whiteLabelId !== wlId) {
      throw new NotFoundException('Movimiento no encontrado');
    }
    if (tx.type !== 'CONSUME') {
      throw new ForbiddenException('Solo se pueden reembolsar consumos de crédito.');
    }
    if (tx.refundedAt) {
      throw new ForbiddenException('Este crédito ya fue reembolsado.');
    }
    const windowMs = REFUND_WINDOW_DAYS * 24 * 60 * 60 * 1000;
    const now = new Date();
    if (now.getTime() > tx.createdAt.getTime() + windowMs) {
      throw new ForbiddenException('La ventana de reembolso (5 días) ya venció.');
    }

    const cost = Math.abs(tx.amount);
    const fiveDaysAgo = new Date(now.getTime() - windowMs);

    // TODO atómico en UNA transacción interactiva: claim (marca refundedAt) +
    // devolución del crédito + suspensión. Si algo falla, se revierte también el
    // claim → nunca queda "reembolsado" sin haber devuelto el crédito. El claim
    // guardado (updateMany con la condición de elegibilidad) sigue siendo la
    // barrera anti doble-reembolso / carrera (row-lock serializa transacciones).
    const refunded = await this.prisma.$transaction(async (db) => {
      const claim = await db.creditTransaction.updateMany({
        where: {
          id: tx.id,
          whiteLabelId: wlId,
          type: 'CONSUME',
          refundedAt: null,
          createdAt: { gte: fiveDaysAgo },
        },
        data: { refundedAt: now },
      });
      if (claim.count === 0) {
        throw new ForbiddenException('El reembolso ya no está disponible.');
      }
      // ¿El crédito de este negocio ya se devolvió (liberación automática por
      // suspensión)? Si sí, NO lo devolvemos de nuevo (evita doble crédito).
      const tenant = tx.tenantId
        ? await db.tenant.findUnique({
            where: { id: tx.tenantId },
            select: { brandName: true, creditReleasedAt: true },
          })
        : null;
      const alreadyReleased = !!tenant?.creditReleasedAt;
      if (!alreadyReleased) {
        await db.whiteLabel.update({
          where: { id: wlId },
          data: { creditsAvailable: { increment: cost }, creditsUsed: { decrement: cost } },
        });
        await db.creditTransaction.create({
          data: {
            whiteLabelId: wlId,
            tenantId: tx.tenantId,
            type: 'REFUND',
            amount: cost,
            note: `Reembolso manual · ${tenant?.brandName ?? 'negocio'} · devuelto al pool`,
          },
        });
      }
      if (tx.tenantId) {
        // Suspende el negocio + marca creditReleasedAt (para que la liberación
        // automática por suspensión no vuelva a devolver el mismo crédito).
        await db.tenant.update({
          where: { id: tx.tenantId },
          data: { status: 'SUSPENDED', suspendedAt: now, creditReleasedAt: now },
        });
      }
      return alreadyReleased ? 0 : cost;
    });

    const after = await this.prisma.whiteLabel.findUnique({
      where: { id: wlId },
      select: { creditsAvailable: true },
    });
    return {
      ok: true,
      refunded,
      creditsAvailable: after?.creditsAvailable ?? 0,
    };
  }

  /**
   * Aviso SMS al dueño de la marca cuando una ventana de reembolso está por
   * vencer (queda ≈1 día). Diario, idempotente por `refundWindowNotifiedAt`.
   * El contador visible en el panel es la señal principal; esto es el recordatorio.
   */
  @Cron(CronExpression.EVERY_DAY_AT_9AM)
  async remindRefundWindowClosing() {
    const now = Date.now();
    const windowMs = REFUND_WINDOW_DAYS * 24 * 60 * 60 * 1000;
    // CONSUME reembolsables cuya ventana vence dentro de las próximas 24h:
    // createdAt ∈ (now-5d, now-4d].
    const from = new Date(now - windowMs);
    const until = new Date(now - windowMs + 24 * 60 * 60 * 1000);
    const rows = await this.prisma.creditTransaction.findMany({
      where: {
        type: 'CONSUME',
        refundedAt: null,
        refundWindowNotifiedAt: null,
        createdAt: { gt: from, lte: until },
      },
      select: { id: true, whiteLabelId: true },
    });
    if (!rows.length) return;
    const byWl = new Map<string, string[]>();
    for (const r of rows) {
      const arr = byWl.get(r.whiteLabelId) ?? [];
      arr.push(r.id);
      byWl.set(r.whiteLabelId, arr);
    }
    for (const [wlId, ids] of byWl) {
      await this.wlNotifications
        .onRefundWindowClosing(wlId, ids.length)
        .catch((e) => this.logger.warn(`onRefundWindowClosing ${wlId}: ${e?.message}`));
      await this.prisma.creditTransaction.updateMany({
        where: { id: { in: ids } },
        data: { refundWindowNotifiedAt: new Date() },
      });
    }
  }
}

/**
 * Resuelve un rango de fechas a partir de un alias (`today`,
 * `this-week`, etc.) o un `from`/`to` ISO si `range=custom`.
 * Default = `this-month`.
 */
export function resolveDateRange(
  range: string | undefined,
  fromIso: string | undefined,
  toIso: string | undefined,
  now: Date,
): { from: Date; to: Date } {
  const r = (range ?? 'this-month').toLowerCase();
  const to = new Date(now);
  // Bug 6 (auditoría facturación 2026-08-17): TODOS los límites de calendario se
  // anclan a la MEDIANOCHE DE BOGOTÁ (America/Bogota, UTC-5). El server corre en
  // UTC → sin esto, `today`/`this-week`/`this-year` arrancaban a la medianoche
  // UTC = 7pm Bogotá del día anterior, y un pago de las 20:00 Bogotá caía en el
  // día equivocado. Mismo timezone canónico que el módulo de cortes. `to` queda
  // como el instante actual (fin de rango = ahora).
  const todayYmd = bogotaYmd(now);
  const { y, m, d } = parseYmd(todayYmd);
  let from: Date;
  switch (r) {
    case 'today':
      from = bogotaDayStartUtc(todayYmd);
      break;
    case 'this-week': {
      // Semana arranca el LUNES (Bogotá). getUTCDay del inicio-de-día Bogotá
      // (05:00Z) sigue cayendo en el mismo día calendario → weekday correcto.
      const dow = bogotaDayStartUtc(todayYmd).getUTCDay(); // 0=dom … 6=sáb
      const mondayYmd = addDaysYmd(todayYmd, -((dow + 6) % 7));
      from = bogotaDayStartUtc(mondayYmd);
      break;
    }
    case 'last-30':
      from = bogotaDayStartUtc(addDaysYmd(todayYmd, -30));
      break;
    case 'this-quarter': {
      // "Este trimestre" = ÚLTIMOS 3 MESES (rolling), no el trimestre calendario.
      const q = new Date(Date.UTC(y, m - 1 - 3, d));
      from = bogotaDayStartUtc(
        fmtYmd(q.getUTCFullYear(), q.getUTCMonth() + 1, q.getUTCDate()),
      );
      break;
    }
    case 'this-year':
      from = bogotaDayStartUtc(fmtYmd(y, 1, 1));
      break;
    case 'custom': {
      from = fromIso ? new Date(fromIso) : new Date(0);
      const t = toIso ? new Date(toIso) : new Date(now);
      return { from, to: t };
    }
    // 'this-month' se quitó del panel (redundante con 'last-30'). Se mantiene el
    // caso por compatibilidad, pero el default ahora es 'last-30'.
    case 'this-month':
      from = bogotaDayStartUtc(fmtYmd(y, m, 1));
      break;
    case 'last-30-default':
    default:
      from = bogotaDayStartUtc(addDaysYmd(todayYmd, -30));
      break;
  }
  return { from, to };
}

const round2 = (n: number) => Math.round(n * 100) / 100;
