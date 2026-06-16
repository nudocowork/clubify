import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { AuthUser } from '../common/decorators/current-user.decorator';
import { SettingsService } from '../settings/settings.service';
import { normalizePlanPeriod } from '../common/plan-period';

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
@Injectable()
export class AdminReportsService {
  constructor(
    private prisma: PrismaService,
    private settings: SettingsService,
  ) {}

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
      where: { role: 'AMBASSADOR' },
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
      where: { role: 'VENDOR' },
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
      where: { role: opts.role, isActive: true },
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

    const now = new Date();
    const { from, to } = resolveDateRange(opts.range, opts.from, opts.to, now);
    // Mes actual y anterior para la comparación de clientes nuevos
    // (independiente del range — esa métrica siempre es mes-a-mes).
    const startThisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const endLastMonth = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);

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
        },
        select: {
          id: true,
          planPeriodicity: true,
          currentPeriodEnd: true,
          createdAt: true,
          subscriptionPriceUsd: true,
        },
      }),
      // FIX 2026-06-07: clientes nuevos = solo ACTIVE creados en el
      // rango. Antes contaba TRIAL también.
      this.prisma.tenant.count({
        where: {
          status: 'ACTIVE',
          createdAt: { gte: startThisMonth, lte: now },
        },
      }),
      this.prisma.tenant.count({
        where: {
          status: 'ACTIVE',
          createdAt: { gte: startLastMonth, lte: endLastMonth },
        },
      }),
      // FIX 2026-06-16 (#14/#37): "pendiente por pagar a afiliados" =
      // (PENDING + APPROVED) con amount − amountPaid. Antes { not: REJECTED }
      // metía RETAINED (congelada, fuera de totales) y PAID en el pool →
      // divergía de Referidos/Comisiones. Definición canónica única.
      this.prisma.commission.aggregate({
        where: { status: { in: ['PENDING', 'APPROVED'] } },
        _sum: { amount: true, amountPaid: true },
      }),
      this.prisma.tenant.groupBy({
        by: ['status'],
        // #13: excluye borrados para que los buckets de "Estado de clientes"
        // no se solapen con "Cancelados" (deletedAt != null).
        where: { deletedAt: null },
        _count: { _all: true },
      }),
      this.prisma.tenant.count({
        where: {
          status: 'ACTIVE',
          OR: [
            { currentPeriodEnd: null },
            { currentPeriodEnd: { gte: now } },
          ],
        },
      }),
      this.prisma.tenant.count({ where: { status: 'TRIAL' } }),
      // Cancellation rate: SUSPENDED total (Tenant no tiene suspendedAt;
      // aproximamos a "actualmente cancelados" sobre activos).
      this.prisma.tenant.count({
        where: { status: 'SUSPENDED' },
      }),
      // Últimos 10 tenants para "Últimos ingresos".
      this.prisma.tenant.findMany({
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
        where: { isActive: true, tenant: { status: 'ACTIVE' } },
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
    const billedAcc: Record<string, { count: number; amount: number }> = {
      MENSUAL: { count: 0, amount: 0 },
      TRIMESTRAL: { count: 0, amount: 0 },
      SEMESTRAL: { count: 0, amount: 0 },
      ANUAL: { count: 0, amount: 0 },
    };
    let billedUsd = 0;
    for (const t of activeTenantsForPricing) {
      const key = normalizePeriod(t.planPeriodicity);
      const period = PERIODS[key];
      const cpe = t.currentPeriodEnd ?? null;
      // Si no hay currentPeriodEnd, aproximamos: el pago inicial ocurrió
      // en createdAt. Para tenants viejos sin Hotmart wire-up esto da
      // una cota inferior razonable.
      const lastPaymentApprox = cpe
        ? new Date(cpe)
        : t.createdAt
          ? new Date(t.createdAt)
          : null;
      if (cpe) lastPaymentApprox?.setMonth(
        (lastPaymentApprox as Date).getMonth() - period.months,
      );
      if (!lastPaymentApprox) continue;
      if (
        lastPaymentApprox.getTime() >= from.getTime() &&
        lastPaymentApprox.getTime() <= to.getTime()
      ) {
        // FIX 2026-06-16 (#18): suma el pago REAL (subscriptionPriceUsd) y
        // sólo cae al canónico cuando no hay precio real registrado.
        const amount = billedAmountFor(t);
        billedUsd += amount;
        billedAcc[key].count += 1;
        billedAcc[key].amount += amount;
      }
    }
    billedUsd = round2(billedUsd);

    const billedByPlan = Object.entries(PERIODS).map(([key, meta]) => ({
      periodicity: key,
      label: meta.label,
      count: billedAcc[key].count,
      billingUsd: round2(billedAcc[key].amount),
    }));

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
        where: { deletedAt: null, status: 'ACTIVE' },
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
        where: { deletedAt: null, status: 'ACTIVE', failedPaymentCount: { gt: 0 } },
      }),
      // #13: "Cancelados" REAL = negocios borrados (soft-delete). Antes
      // buscaba status 'CANCELLED' que tampoco existe → 0 fijo.
      this.prisma.tenant.count({ where: { deletedAt: { not: null } } }),
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

    // Variación clientes nuevos mes a mes.
    const deltaPct = newCustomersPrev
      ? Math.round(
          ((newCustomersCurrent - newCustomersPrev) / newCustomersPrev) *
            1000,
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

    return {
      range: {
        kind: opts.range ?? 'this-month',
        from,
        to,
      },
      banner: {
        billedUsd,
        billedByPlan,
        newCustomers: {
          currentMonth: newCustomersCurrent,
          lastMonth: newCustomersPrev,
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
  }
}

/**
 * Resuelve un rango de fechas a partir de un alias (`today`,
 * `this-week`, etc.) o un `from`/`to` ISO si `range=custom`.
 * Default = `this-month`.
 */
function resolveDateRange(
  range: string | undefined,
  fromIso: string | undefined,
  toIso: string | undefined,
  now: Date,
): { from: Date; to: Date } {
  const r = (range ?? 'this-month').toLowerCase();
  const to = new Date(now);
  let from: Date;
  switch (r) {
    case 'today':
      from = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      break;
    case 'this-week': {
      const day = now.getDay();
      const monday = new Date(now);
      monday.setDate(now.getDate() - ((day + 6) % 7));
      monday.setHours(0, 0, 0, 0);
      from = monday;
      break;
    }
    case 'last-30':
      from = new Date(now.getTime() - 30 * 86400_000);
      break;
    case 'this-quarter': {
      const q = Math.floor(now.getMonth() / 3);
      from = new Date(now.getFullYear(), q * 3, 1);
      break;
    }
    case 'this-year':
      from = new Date(now.getFullYear(), 0, 1);
      break;
    case 'custom': {
      from = fromIso ? new Date(fromIso) : new Date(0);
      const t = toIso ? new Date(toIso) : now;
      return { from, to: t };
    }
    case 'this-month':
    default:
      from = new Date(now.getFullYear(), now.getMonth(), 1);
      break;
  }
  return { from, to };
}

const round2 = (n: number) => Math.round(n * 100) / 100;
