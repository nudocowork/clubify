import { ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { AuthUser } from '../common/decorators/current-user.decorator';

export type Insight = {
  id: string;
  severity: 'urgent' | 'attention' | 'success' | 'info' | 'tip';
  emoji: string;
  title: string;
  body: string;
  href?: string;
  ctaLabel?: string;
};

@Injectable()
export class MetricsService {
  constructor(private prisma: PrismaService) {}

  async global(user: AuthUser) {
    if (user.role !== 'SUPER_ADMIN') throw new ForbiddenException();
    const since30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const since7 = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const in3Days = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);

    // Scope por marca blanca: si la sesión "entró" a una marca (PLATFORM_OWNER
    // impersonando white-label), las métricas se limitan a sus tenants. Sin
    // marca activa (null) → vista global de toda la plataforma (sin cambios).
    const wlId = user.whiteLabelId ?? null;
    const tenantWhere = wlId ? { whiteLabelId: wlId } : {};
    // Modelos con tenantId directo (pass/customer/order) → filtro por relación.
    const relWhere = wlId ? { tenant: { whiteLabelId: wlId } } : {};
    // Commission no tiene tenantId: cuelga del tenant vía referralUse.
    const commWhere = wlId
      ? { referralUse: { tenant: { whiteLabelId: wlId } } }
      : {};

    const [
      tenants,
      activeTenantsByPlan,
      trialTenants,
      suspendedTenants,
      expiringSoon,
      passes,
      customers,
      orders30Agg,
      newSignups7,
      pendingComm,
      churnedLast30,
      activatedLast30,
    ] = await Promise.all([
      this.prisma.tenant.count({ where: tenantWhere }),
      this.prisma.tenant.groupBy({
        by: ['planId'],
        where: { status: 'ACTIVE', ...tenantWhere },
        _count: { _all: true },
      }),
      this.prisma.tenant.count({ where: { status: 'TRIAL', ...tenantWhere } }),
      this.prisma.tenant.count({
        where: { status: 'SUSPENDED', ...tenantWhere },
      }),
      this.prisma.tenant.count({
        where: {
          status: 'TRIAL',
          trialEndsAt: { gte: new Date(), lte: in3Days },
          ...tenantWhere,
        },
      }),
      this.prisma.pass.count({ where: relWhere }),
      this.prisma.customer.count({ where: relWhere }),
      this.prisma.order.aggregate({
        _count: { _all: true },
        _sum: { total: true },
        where: {
          createdAt: { gte: since30 },
          status: { not: 'CANCELLED' },
          ...relWhere,
        },
      }),
      this.prisma.tenant.count({
        where: { createdAt: { gte: since7 }, ...tenantWhere },
      }),
      this.prisma.commission.aggregate({
        _sum: { amount: true },
        where: { status: 'PENDING', ...commWhere },
      }),
      this.prisma.tenant.count({
        where: {
          status: 'SUSPENDED',
          suspendedAt: { gte: since30 },
          ...tenantWhere,
        },
      }),
      this.prisma.tenant.count({
        where: {
          status: 'ACTIVE',
          lastPaymentAttemptAt: { gte: since30 },
          ...tenantWhere,
        },
      }),
    ]);

    const plans = await this.prisma.plan.findMany({
      where: { id: { in: activeTenantsByPlan.map((g) => g.planId) } },
      select: { id: true, name: true, priceMonthly: true },
    });
    const priceById = new Map(plans.map((p) => [p.id, Number(p.priceMonthly)]));

    let mrrUsd = 0;
    let activeTenants = 0;
    const breakdown: Record<string, { count: number; mrr: number }> = {};
    for (const g of activeTenantsByPlan) {
      const price = priceById.get(g.planId) ?? 0;
      const plan = plans.find((p) => p.id === g.planId);
      mrrUsd += price * g._count._all;
      activeTenants += g._count._all;
      if (plan) {
        breakdown[plan.name] = { count: g._count._all, mrr: price * g._count._all };
      }
    }

    // Conversion: % de trials terminados en últimos 30d que pasaron a ACTIVE
    const conversionRate30 =
      activatedLast30 + churnedLast30 > 0
        ? Math.round((activatedLast30 / (activatedLast30 + churnedLast30)) * 100)
        : null;

    return {
      tenants,
      activeTenants,
      trialTenants,
      suspendedTenants,
      expiringSoon,
      passes,
      customers,
      orders30: orders30Agg._count._all,
      revenue30: Number(orders30Agg._sum.total ?? 0),
      mrrUsd,
      arrUsd: mrrUsd * 12,
      planBreakdown: breakdown,
      churnedLast30,
      conversionRate30,
      newSignups7,
      pendingCommissions: pendingComm._sum.amount ?? 0,
    };
  }

  async tenant(user: AuthUser, tenantIdParam?: string) {
    const tid = user.role === 'SUPER_ADMIN' ? tenantIdParam : user.tenantId ?? undefined;
    if (!tid) throw new ForbiddenException();

    const today0 = new Date();
    today0.setHours(0, 0, 0, 0);
    const since30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const since7 = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const [
      cards,
      customers,
      passes,
      installed,
      walletApple,
      walletGoogle,
      walletNone,
      stamps30,
      redemptions30,
      ordersToday,
      ordersTodayAgg,
      orders30,
      orders30Agg,
      orders7Agg,
      pendingOrders,
      newCustomers30,
      recurringCustomers30,
      ratingsAgg,
      ratings30Agg,
      stampRevToday,
      stampRev30,
      stampRev7,
    ] = await Promise.all([
      this.prisma.card.count({ where: { tenantId: tid } }),
      this.prisma.customer.count({ where: { tenantId: tid } }),
      this.prisma.pass.count({ where: { tenantId: tid } }),
      this.prisma.pass.count({
        where: { tenantId: tid, walletDevices: { some: {} } },
      }),
      // Plataformas wallet — cuántos clientes eligieron Apple vs Google al
      // instalar. Si walletPlatform es null, todavía no instaló (escaneó
      // el QR pero no llevó la tarjeta al wallet).
      this.prisma.pass.count({
        where: { tenantId: tid, walletPlatform: 'APPLE' },
      }),
      this.prisma.pass.count({
        where: { tenantId: tid, walletPlatform: 'GOOGLE' },
      }),
      this.prisma.pass.count({
        where: { tenantId: tid, walletPlatform: null },
      }),
      this.prisma.stamp.count({
        where: { tenantId: tid, action: 'STAMP', createdAt: { gte: since30 } },
      }),
      this.prisma.stamp.count({
        where: { tenantId: tid, action: 'REDEEM', createdAt: { gte: since30 } },
      }),
      this.prisma.order.count({
        where: {
          tenantId: tid,
          createdAt: { gte: today0 },
          status: { not: 'CANCELLED' },
        },
      }),
      this.prisma.order.aggregate({
        _sum: { total: true },
        where: {
          tenantId: tid,
          createdAt: { gte: today0 },
          status: { not: 'CANCELLED' },
        },
      }),
      this.prisma.order.count({
        where: {
          tenantId: tid,
          createdAt: { gte: since30 },
          status: { not: 'CANCELLED' },
        },
      }),
      this.prisma.order.aggregate({
        _sum: { total: true },
        _avg: { total: true },
        where: {
          tenantId: tid,
          createdAt: { gte: since30 },
          status: { not: 'CANCELLED' },
        },
      }),
      this.prisma.order.aggregate({
        _sum: { total: true },
        where: {
          tenantId: tid,
          createdAt: { gte: since7 },
          status: { not: 'CANCELLED' },
        },
      }),
      this.prisma.order.count({
        where: { tenantId: tid, status: 'PENDING' },
      }),
      this.prisma.customer.count({
        where: { tenantId: tid, createdAt: { gte: since30 } },
      }),
      this.prisma.customer.count({
        where: { tenantId: tid, totalOrdersCount: { gte: 2 } },
      }),
      this.prisma.order.aggregate({
        where: { tenantId: tid, rating: { not: null } },
        _avg: { rating: true },
        _count: { rating: true },
      }),
      this.prisma.order.aggregate({
        where: {
          tenantId: tid,
          rating: { not: null },
          ratedAt: { gte: since30 },
        },
        _avg: { rating: true },
        _count: { rating: true },
      }),
      // #7: facturación de SELLOS de compra (STAMP/VISIT con monto, sin
      // orderId para no duplicar con órdenes). Cada sello = una compra.
      this.prisma.stamp.aggregate({
        _sum: { purchaseAmount: true },
        _count: { _all: true },
        where: { tenantId: tid, orderId: null, action: { in: ['STAMP', 'VISIT'] }, purchaseAmount: { gt: 0 }, createdAt: { gte: today0 } },
      }),
      this.prisma.stamp.aggregate({
        _sum: { purchaseAmount: true },
        _count: { _all: true },
        where: { tenantId: tid, orderId: null, action: { in: ['STAMP', 'VISIT'] }, purchaseAmount: { gt: 0 }, createdAt: { gte: since30 } },
      }),
      this.prisma.stamp.aggregate({
        _sum: { purchaseAmount: true },
        _count: { _all: true },
        where: { tenantId: tid, orderId: null, action: { in: ['STAMP', 'VISIT'] }, purchaseAmount: { gt: 0 }, createdAt: { gte: since7 } },
      }),
    ]);

    // Top productos (por timesOrdered si está poblado, sino por aggregations en items)
    const topProducts = await this.prisma.product.findMany({
      where: { tenantId: tid },
      orderBy: { timesOrdered: 'desc' },
      take: 5,
      select: {
        id: true,
        name: true,
        timesOrdered: true,
        basePrice: true,
        category: { select: { name: true } },
      },
    });

    // Si timesOrdered está en 0 (no implementado el incremento automático), calculo desde orders
    const allTopAreZero = topProducts.every((p) => p.timesOrdered === 0);
    let topByItems: any[] = [];
    if (allTopAreZero) {
      const orders = await this.prisma.order.findMany({
        where: {
          tenantId: tid,
          createdAt: { gte: since30 },
          status: { not: 'CANCELLED' },
        },
        select: { items: true },
      });
      const counter = new Map<string, { name: string; count: number }>();
      for (const o of orders) {
        for (const it of (o.items as any[]) ?? []) {
          const key = it.productId;
          const cur = counter.get(key) ?? { name: it.name, count: 0 };
          cur.count += it.qty;
          counter.set(key, cur);
        }
      }
      topByItems = Array.from(counter.entries())
        .map(([id, v]) => ({ id, name: v.name, count: v.count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 5);
    }

    return {
      // legacy v1
      cards,
      customers,
      passes,
      installed,
      // Wallet platform breakdown (Apple vs Google vs sin instalar)
      walletApple,
      walletGoogle,
      walletNone,
      stamps30,
      redemptions30,
      // v2 — comercial. #7: facturación = órdenes + sellos de compra.
      ordersToday: ordersToday + (stampRevToday._count._all ?? 0),
      revenueToday: Number(ordersTodayAgg._sum.total ?? 0) + Number(stampRevToday._sum.purchaseAmount ?? 0),
      orders30: orders30 + (stampRev30._count._all ?? 0),
      revenue30: Number(orders30Agg._sum.total ?? 0) + Number(stampRev30._sum.purchaseAmount ?? 0),
      revenue7: Number(orders7Agg._sum.total ?? 0) + Number(stampRev7._sum.purchaseAmount ?? 0),
      avgTicket: (() => {
        const totalRev = Number(orders30Agg._sum.total ?? 0) + Number(stampRev30._sum.purchaseAmount ?? 0);
        const totalCount = orders30 + (stampRev30._count._all ?? 0);
        return totalCount > 0 ? Math.round((totalRev / totalCount) * 100) / 100 : 0;
      })(),
      pendingOrders,
      newCustomers30,
      recurringCustomers30,
      avgRating: ratingsAgg._avg.rating
        ? Number(ratingsAgg._avg.rating.toFixed(2))
        : null,
      ratingsCount: ratingsAgg._count.rating ?? 0,
      avgRating30: ratings30Agg._avg.rating
        ? Number(ratings30Agg._avg.rating.toFixed(2))
        : null,
      ratingsCount30: ratings30Agg._count.rating ?? 0,
      topProducts: allTopAreZero
        ? topByItems
        : topProducts.map((p) => ({
            id: p.id,
            name: p.name,
            count: p.timesOrdered,
            category: p.category?.name ?? 'Sin categoría',
          })),
    };
  }

  // ============================================================
  //                       INSIGHTS ACCIONABLES
  // ============================================================

  /**
   * Genera "tarjetas" de insights basadas en el estado real del tenant.
   * Cada insight tiene severity, copy y opcionalmente un CTA.
   * Pensado para mostrar en la home del panel — el dueño debe ver al instante
   * qué necesita atención hoy.
   */
  async insights(user: AuthUser, tenantIdParam?: string) {
    const tid = this.getTid(user, tenantIdParam);
    const now = new Date();
    const since7 = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const since14 = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
    const today0 = new Date();
    today0.setHours(0, 0, 0, 0);
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

    const [
      tenant,
      pendingOldOrders,
      ordersToday,
      newCustomers7,
      newCustomers14,
      cardsCount,
      storefront,
      heavyCustomersWithoutPass,
      ordersThisWeekAgg,
      ordersLastWeekAgg,
      installedRate,
    ] = await Promise.all([
      this.prisma.tenant.findUnique({
        where: { id: tid },
        select: {
          status: true,
          trialEndsAt: true,
          brandName: true,
          logoUrl: true,
          whatsappPhone: true,
        },
      }),
      this.prisma.order.findMany({
        where: {
          tenantId: tid,
          status: 'PENDING',
          createdAt: { lt: oneHourAgo },
        },
        select: { id: true, code: true, createdAt: true },
        take: 5,
      }),
      this.prisma.order.count({
        where: {
          tenantId: tid,
          createdAt: { gte: today0 },
          status: { not: 'CANCELLED' },
        },
      }),
      this.prisma.customer.count({
        where: { tenantId: tid, createdAt: { gte: since7 } },
      }),
      this.prisma.customer.count({
        where: {
          tenantId: tid,
          createdAt: { gte: since14, lt: since7 },
        },
      }),
      this.prisma.card.count({ where: { tenantId: tid, isActive: true } }),
      this.prisma.storefront.findFirst({
        where: { tenantId: tid },
        select: { isPublished: true },
      }),
      this.prisma.customer.findMany({
        where: {
          tenantId: tid,
          totalOrdersCount: { gte: 3 },
          passes: { none: {} },
        },
        select: { id: true, fullName: true, totalOrdersCount: true },
        take: 3,
      }),
      this.prisma.order.aggregate({
        _sum: { total: true },
        _count: { _all: true },
        where: {
          tenantId: tid,
          createdAt: { gte: since7 },
          status: { not: 'CANCELLED' },
        },
      }),
      this.prisma.order.aggregate({
        _sum: { total: true },
        _count: { _all: true },
        where: {
          tenantId: tid,
          createdAt: { gte: since14, lt: since7 },
          status: { not: 'CANCELLED' },
        },
      }),
      this.computeInstalledRate(tid),
    ]);

    const insights: Insight[] = [];

    // 1) Pedidos pendientes >1h — URGENT
    if (pendingOldOrders.length > 0) {
      insights.push({
        id: 'pending-old',
        severity: 'urgent',
        emoji: '🚨',
        title: `${pendingOldOrders.length} pedido${pendingOldOrders.length === 1 ? '' : 's'} sin confirmar hace más de 1 hora`,
        body: 'Tus clientes están esperando. Confírmalos o márcalos como cancelados.',
        href: '/app/orders',
        ctaLabel: 'Ver pedidos',
      });
    }

    // 2) Trial expira en < 3 días
    if (tenant?.status === 'TRIAL' && tenant.trialEndsAt) {
      const daysLeft = Math.ceil(
        (tenant.trialEndsAt.getTime() - now.getTime()) /
          (24 * 60 * 60 * 1000),
      );
      if (daysLeft >= 0 && daysLeft <= 3) {
        insights.push({
          id: 'trial-expiring',
          severity: 'attention',
          emoji: '⏰',
          title: `Tu prueba gratis termina en ${daysLeft} día${daysLeft === 1 ? '' : 's'}`,
          body: 'Activa tu suscripción para no perder acceso. Puedes cancelar cuando quieras.',
          href: '/app/billing',
          ctaLabel: 'Activar suscripción',
        });
      }
    }

    // 3) Setup incompleto: sin tarjeta de fidelización
    if (cardsCount === 0) {
      insights.push({
        id: 'no-card',
        severity: 'tip',
        emoji: '💡',
        title: 'Aún no tienes tarjeta de fidelización',
        body: 'La tarjeta de sellos hace que clientes vuelvan 3× más. Crea una en 2 minutos.',
        href: '/app/cards/new',
        ctaLabel: 'Crear mi primera tarjeta',
      });
    }

    // 4) Storefront no publicado
    if (storefront && !storefront.isPublished) {
      insights.push({
        id: 'sf-unpublished',
        severity: 'tip',
        emoji: '🔒',
        title: 'Tu mini-sitio está en borrador',
        body: 'Mientras esté oculto, nadie puede pedir desde tu link público.',
        href: '/app/storefront',
        ctaLabel: 'Publicar sitio',
      });
    }

    // 5) Sin WhatsApp configurado
    if (tenant && !tenant.whatsappPhone) {
      insights.push({
        id: 'no-whatsapp',
        severity: 'attention',
        emoji: '📱',
        title: 'Configura tu WhatsApp del negocio',
        body: 'Es donde te llegan los pedidos. Sin esto, los clientes no pueden enviarte sus carritos.',
        href: '/app/storefront',
        ctaLabel: 'Configurar',
      });
    }

    // 6) Clientes nuevos esta semana (positivo)
    if (newCustomers7 >= 3) {
      const delta = newCustomers7 - newCustomers14;
      insights.push({
        id: 'new-customers',
        severity: 'success',
        emoji: '🎉',
        title: `${newCustomers7} clientes nuevos esta semana`,
        body:
          delta > 0
            ? `Vas ${delta} arriba que la semana pasada. Buen trabajo.`
            : 'Mantén el ritmo invitando con tu link público.',
        href: '/app/customers',
        ctaLabel: 'Ver clientes',
      });
    }

    // 7) Revenue 7d vs 14-7d (caída significativa)
    const r7 = Number(ordersThisWeekAgg._sum.total ?? 0);
    const rPrev7 = Number(ordersLastWeekAgg._sum.total ?? 0);
    if (rPrev7 > 0 && r7 < rPrev7 * 0.7) {
      const dropPct = Math.round((1 - r7 / rPrev7) * 100);
      insights.push({
        id: 'revenue-drop',
        severity: 'attention',
        emoji: '📉',
        title: `Tus ventas bajaron ${dropPct}% vs la semana pasada`,
        body: 'Considera lanzar una promo de recuperación o reactivar clientes que no piden hace tiempo.',
        href: '/app/promos',
        ctaLabel: 'Crear promo',
      });
    }

    // 8) Sin pedidos hoy y son después del mediodía
    if (ordersToday === 0 && now.getHours() >= 14) {
      insights.push({
        id: 'no-orders-today',
        severity: 'info',
        emoji: '📭',
        title: 'Aún no tienes pedidos hoy',
        body: 'Comparte tu link en Instagram Stories o por estado de WhatsApp para mover ventas.',
        href: '/app/storefront',
        ctaLabel: 'Compartir link',
      });
    }

    // 9) Clientes recurrentes sin tarjeta — oportunidad
    if (heavyCustomersWithoutPass.length > 0 && cardsCount > 0) {
      const names = heavyCustomersWithoutPass.map((c) => c.fullName).join(', ');
      insights.push({
        id: 'heavy-no-pass',
        severity: 'tip',
        emoji: '✨',
        title: `${heavyCustomersWithoutPass.length} cliente${heavyCustomersWithoutPass.length === 1 ? '' : 's'} recurrente${heavyCustomersWithoutPass.length === 1 ? '' : 's'} sin tarjeta`,
        body: `${names} ya hizo varios pedidos. Emítele tarjeta para retenerlo con sellos.`,
        href: '/app/customers',
        ctaLabel: 'Emitir tarjetas',
      });
    }

    // 10) Cumpleaños en los próximos 7 días
    const upcomingBirthdays = await this.findUpcomingBirthdays(tid, 7);
    if (upcomingBirthdays.length > 0) {
      const names = upcomingBirthdays
        .slice(0, 3)
        .map((c) => c.fullName)
        .join(', ');
      const more =
        upcomingBirthdays.length > 3
          ? ` y ${upcomingBirthdays.length - 3} más`
          : '';
      insights.push({
        id: 'birthdays-week',
        severity: 'tip',
        emoji: '🎂',
        title: `${upcomingBirthdays.length} cumpleaños esta semana`,
        body: `Cumplen pronto: ${names}${more}. Mándales un saludo o un cupón especial — fideliza a la próxima vez.`,
        href: '/app/customers',
        ctaLabel: 'Ver clientes',
      });
    }

    // 11) Stock agotado en productos visibles
    const outOfStock = await this.prisma.product.findMany({
      where: { tenantId: tid, stock: 0 },
      select: { id: true, name: true },
      take: 5,
    });
    if (outOfStock.length > 0) {
      const names = outOfStock.slice(0, 3).map((p) => p.name).join(', ');
      const more = outOfStock.length > 3 ? ` y ${outOfStock.length - 3} más` : '';
      insights.push({
        id: 'stock-out',
        severity: 'attention',
        emoji: '📦',
        title: `${outOfStock.length} producto${outOfStock.length === 1 ? ' agotado' : 's agotados'}`,
        body: `${names}${more} están en 0 y se ocultaron del menú. Repón inventario y vuelve a marcarlos visibles.`,
        href: '/app/menu',
        ctaLabel: 'Reponer stock',
      });
    }

    // 12) Stock bajo (≤ stockAlert) — pedido inminente
    const lowStock = await this.prisma.product.findMany({
      where: {
        tenantId: tid,
        stock: { gt: 0 },
        stockAlert: { not: null },
      },
      select: { id: true, name: true, stock: true, stockAlert: true },
      take: 10,
    });
    const reallyLow = lowStock.filter(
      (p) => p.stock !== null && p.stockAlert !== null && p.stock <= p.stockAlert,
    );
    if (reallyLow.length > 0) {
      const top = reallyLow
        .slice(0, 3)
        .map((p) => `${p.name} (${p.stock})`)
        .join(', ');
      insights.push({
        id: 'stock-low',
        severity: 'tip',
        emoji: '⚠️',
        title: `${reallyLow.length} producto${reallyLow.length === 1 ? '' : 's'} con stock bajo`,
        body: `Quedan pocos: ${top}. Pide al proveedor antes de que se agoten.`,
        href: '/app/menu',
        ctaLabel: 'Ver inventario',
      });
    }

    // 13) Tasa de instalación de wallet baja
    if (installedRate.totalPasses >= 5 && installedRate.rate < 0.4) {
      insights.push({
        id: 'wallet-install-low',
        severity: 'tip',
        emoji: '📲',
        title: `Solo ${Math.round(installedRate.rate * 100)}% de tus tarjetas están en Wallet`,
        body: 'Recuerda mostrarle el QR a tus clientes para que la guarden — vuelven 2× más.',
        href: '/app/cards',
        ctaLabel: 'Ver tarjetas',
      });
    }

    // Ordenar por severidad
    const order: Record<Insight['severity'], number> = {
      urgent: 0,
      attention: 1,
      success: 2,
      tip: 3,
      info: 4,
    };
    insights.sort((a, b) => order[a.severity] - order[b.severity]);

    return { insights };
  }

  /**
   * Feed de actividad reciente unificado: pedidos creados, sellos otorgados,
   * pases emitidos, clientes nuevos. Pensado para mostrar las últimas 15
   * cosas que pasaron en el negocio.
   */
  async activity(user: AuthUser, tenantIdParam?: string) {
    const tid = this.getTid(user, tenantIdParam);
    const since = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);

    const [orders, stamps, passes, customers] = await Promise.all([
      this.prisma.order.findMany({
        where: { tenantId: tid, createdAt: { gte: since } },
        select: {
          id: true,
          code: true,
          total: true,
          createdAt: true,
          status: true,
          customer: { select: { fullName: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 15,
      }),
      this.prisma.stamp.findMany({
        where: { tenantId: tid, createdAt: { gte: since } },
        select: {
          id: true,
          action: true,
          amount: true,
          createdAt: true,
          customer: { select: { id: true, fullName: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 15,
      }),
      this.prisma.pass.findMany({
        where: { tenantId: tid, issuedAt: { gte: since } },
        select: {
          id: true,
          issuedAt: true,
          customer: { select: { id: true, fullName: true } },
          card: { select: { name: true } },
        },
        orderBy: { issuedAt: 'desc' },
        take: 15,
      }),
      this.prisma.customer.findMany({
        where: { tenantId: tid, createdAt: { gte: since } },
        select: { id: true, fullName: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
        take: 15,
      }),
    ]);

    type Event = {
      id: string;
      kind: 'order' | 'stamp' | 'redeem' | 'pass' | 'customer';
      at: string;
      title: string;
      detail?: string;
      href?: string;
      emoji: string;
    };
    const events: Event[] = [];

    for (const o of orders) {
      events.push({
        id: `o-${o.id}`,
        kind: 'order',
        at: o.createdAt.toISOString(),
        emoji: '🛒',
        title: `Pedido #${o.code}`,
        detail: `${o.customer?.fullName ?? 'Walk-in'} · COP ${Number(o.total).toLocaleString('es-CO')}`,
        href: `/app/orders/${o.id}`,
      });
    }
    for (const s of stamps) {
      events.push({
        id: `s-${s.id}`,
        kind: s.action === 'REDEEM' ? 'redeem' : 'stamp',
        at: s.createdAt.toISOString(),
        emoji: s.action === 'REDEEM' ? '🎁' : '⭐',
        title:
          s.action === 'REDEEM'
            ? `Premio canjeado`
            : `+${Number(s.amount)} sello${Number(s.amount) === 1 ? '' : 's'}`,
        detail: s.customer?.fullName,
        href: s.customer?.id
          ? `/app/customers/${s.customer.id}`
          : undefined,
      });
    }
    for (const p of passes) {
      events.push({
        id: `p-${p.id}`,
        kind: 'pass',
        at: p.issuedAt.toISOString(),
        emoji: '💳',
        title: `Tarjeta emitida`,
        detail: `${p.customer.fullName} · ${p.card.name}`,
        href: `/app/customers/${p.customer.id}`,
      });
    }
    for (const c of customers) {
      events.push({
        id: `c-${c.id}`,
        kind: 'customer',
        at: c.createdAt.toISOString(),
        emoji: '🙋',
        title: `Nuevo cliente`,
        detail: c.fullName,
        href: `/app/customers/${c.id}`,
      });
    }

    events.sort((a, b) => (a.at < b.at ? 1 : -1));
    return { events: events.slice(0, 20) };
  }

  /**
   * Devuelve clientes cuyo cumpleaños cae en los próximos N días.
   * Comparación por (mes, día) ignorando el año.
   */
  private async findUpcomingBirthdays(tid: string, days: number) {
    const customers = await this.prisma.customer.findMany({
      where: { tenantId: tid, birthday: { not: null } },
      select: { id: true, fullName: true, birthday: true },
    });
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const out: { id: string; fullName: string; birthday: Date }[] = [];
    for (const c of customers) {
      if (!c.birthday) continue;
      const b = new Date(c.birthday);
      const next = new Date(today.getFullYear(), b.getMonth(), b.getDate());
      if (next < today) next.setFullYear(today.getFullYear() + 1);
      const diff = (next.getTime() - today.getTime()) / (24 * 60 * 60 * 1000);
      if (diff >= 0 && diff <= days) {
        out.push({ id: c.id, fullName: c.fullName, birthday: c.birthday });
      }
    }
    return out;
  }

  private async computeInstalledRate(tid: string) {
    const [totalPasses, installed] = await Promise.all([
      this.prisma.pass.count({ where: { tenantId: tid } }),
      this.prisma.pass.count({
        where: { tenantId: tid, walletDevices: { some: {} } },
      }),
    ]);
    const rate = totalPasses === 0 ? 0 : installed / totalPasses;
    return { totalPasses, installed, rate };
  }

  // ============================================================
  //                       ANALYTICS AVANZADOS
  // ============================================================

  private getTid(user: AuthUser, tenantIdParam?: string) {
    const tid =
      user.role === 'SUPER_ADMIN' ? tenantIdParam : user.tenantId ?? undefined;
    if (!tid) throw new ForbiddenException();
    return tid;
  }

  /** Funnel comercial: cuántos pedidos llegan a cada etapa (últimos N días). */
  async funnelOrders(user: AuthUser, days = 30, tenantIdParam?: string) {
    const tid = this.getTid(user, tenantIdParam);
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const orders = await this.prisma.order.findMany({
      where: { tenantId: tid, createdAt: { gte: since } },
      select: {
        status: true,
        confirmedAt: true,
        readyAt: true,
        deliveredAt: true,
        cancelledAt: true,
      },
    });

    const total = orders.length;
    const confirmed = orders.filter((o) => o.confirmedAt !== null).length;
    const ready = orders.filter((o) => o.readyAt !== null).length;
    const delivered = orders.filter((o) => o.deliveredAt !== null).length;
    const cancelled = orders.filter((o) => o.status === 'CANCELLED').length;

    const pct = (n: number, base: number) =>
      base === 0 ? 0 : Math.round((n / base) * 1000) / 10;

    return {
      days,
      stages: [
        { key: 'created', label: 'Creados', count: total, pct: 100 },
        {
          key: 'confirmed',
          label: 'Confirmados',
          count: confirmed,
          pct: pct(confirmed, total),
        },
        {
          key: 'ready',
          label: 'Listos',
          count: ready,
          pct: pct(ready, total),
        },
        {
          key: 'delivered',
          label: 'Entregados',
          count: delivered,
          pct: pct(delivered, total),
        },
      ],
      cancelled,
      cancelRate: pct(cancelled, total),
    };
  }

  /** Funnel de fidelización: del pase a la canjeación. */
  async funnelLoyalty(user: AuthUser, tenantIdParam?: string) {
    const tid = this.getTid(user, tenantIdParam);

    const cards = await this.prisma.card.findMany({
      where: { tenantId: tid, type: 'STAMPS' },
      select: { id: true, stampsRequired: true },
    });
    if (cards.length === 0) {
      return {
        stages: [
          { key: 'emitted', label: 'Pases emitidos', count: 0, pct: 100 },
          { key: 'firstStamp', label: 'Con ≥1 sello', count: 0, pct: 0 },
          { key: 'halfway', label: '≥50% del cartón', count: 0, pct: 0 },
          { key: 'completed', label: 'Cartón completo', count: 0, pct: 0 },
          { key: 'redeemed', label: 'Premio canjeado', count: 0, pct: 0 },
        ],
      };
    }
    const cardIds = cards.map((c) => c.id);

    const passes = await this.prisma.pass.findMany({
      where: { tenantId: tid, cardId: { in: cardIds } },
      select: {
        id: true,
        stampsCount: true,
        cardId: true,
        status: true,
      },
    });

    const reqByCard = new Map(cards.map((c) => [c.id, c.stampsRequired ?? 10]));
    const emitted = passes.length;
    const firstStamp = passes.filter((p) => p.stampsCount >= 1).length;
    const halfway = passes.filter(
      (p) => p.stampsCount >= Math.ceil((reqByCard.get(p.cardId) ?? 10) / 2),
    ).length;
    const completed = passes.filter(
      (p) => p.stampsCount >= (reqByCard.get(p.cardId) ?? 10),
    ).length;

    const passIds = passes.map((p) => p.id);
    const redeemed = passIds.length
      ? await this.prisma.stamp.count({
          where: {
            tenantId: tid,
            passId: { in: passIds },
            action: 'REDEEM',
          },
        })
      : 0;

    const pct = (n: number, base: number) =>
      base === 0 ? 0 : Math.round((n / base) * 1000) / 10;

    return {
      stages: [
        { key: 'emitted', label: 'Pases emitidos', count: emitted, pct: 100 },
        {
          key: 'firstStamp',
          label: 'Con ≥1 sello',
          count: firstStamp,
          pct: pct(firstStamp, emitted),
        },
        {
          key: 'halfway',
          label: '≥50% del cartón',
          count: halfway,
          pct: pct(halfway, emitted),
        },
        {
          key: 'completed',
          label: 'Cartón completo',
          count: completed,
          pct: pct(completed, emitted),
        },
        {
          key: 'redeemed',
          label: 'Premio canjeado',
          count: redeemed,
          pct: pct(redeemed, emitted),
        },
      ],
    };
  }

  /** Funnel de clientes: 1 → 2+ → 4+ pedidos. */
  async funnelCustomers(user: AuthUser, tenantIdParam?: string) {
    const tid = this.getTid(user, tenantIdParam);

    const [total, oneOrder, repeat, loyal] = await Promise.all([
      this.prisma.customer.count({ where: { tenantId: tid } }),
      this.prisma.customer.count({
        where: { tenantId: tid, totalOrdersCount: { gte: 1 } },
      }),
      this.prisma.customer.count({
        where: { tenantId: tid, totalOrdersCount: { gte: 2 } },
      }),
      this.prisma.customer.count({
        where: { tenantId: tid, totalOrdersCount: { gte: 4 } },
      }),
    ]);

    const pct = (n: number, base: number) =>
      base === 0 ? 0 : Math.round((n / base) * 1000) / 10;

    return {
      stages: [
        { key: 'all', label: 'Total clientes', count: total, pct: 100 },
        {
          key: 'firstOrder',
          label: '≥1 pedido',
          count: oneOrder,
          pct: pct(oneOrder, total),
        },
        {
          key: 'repeat',
          label: '≥2 pedidos (recurrente)',
          count: repeat,
          pct: pct(repeat, total),
        },
        {
          key: 'loyal',
          label: '≥4 pedidos (fiel)',
          count: loyal,
          pct: pct(loyal, total),
        },
      ],
      repeatRate: pct(repeat, oneOrder),
    };
  }

  /** Serie diaria de pedidos & revenue (últimos N días, incluye días vacíos). */
  async timeseriesOrders(user: AuthUser, days = 30, tenantIdParam?: string) {
    const tid = this.getTid(user, tenantIdParam);
    const since = new Date();
    since.setHours(0, 0, 0, 0);
    since.setDate(since.getDate() - (days - 1));

    const rows = await this.prisma.$queryRaw<
      { day: Date; count: bigint; total: any }[]
    >`
      SELECT date_trunc('day', "createdAt") AS day,
             COUNT(*)::bigint AS count,
             SUM("total") AS total
      FROM "Order"
      WHERE "tenantId" = ${tid}
        AND "createdAt" >= ${since}
        AND "status" <> 'CANCELLED'
      GROUP BY 1
      ORDER BY 1 ASC
    `;
    const map = new Map<string, { count: number; total: number }>();
    for (const r of rows) {
      const key = new Date(r.day).toISOString().slice(0, 10);
      map.set(key, {
        count: Number(r.count),
        total: Number(r.total ?? 0),
      });
    }
    const series: { date: string; count: number; total: number }[] = [];
    for (let i = 0; i < days; i++) {
      const d = new Date(since);
      d.setDate(since.getDate() + i);
      const key = d.toISOString().slice(0, 10);
      const v = map.get(key) ?? { count: 0, total: 0 };
      series.push({ date: key, count: v.count, total: v.total });
    }
    return { days, series };
  }

  /** Heatmap de pedidos por (día de semana × hora) últimos 30 días. */
  async heatmapOrders(user: AuthUser, tenantIdParam?: string) {
    const tid = this.getTid(user, tenantIdParam);
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const orders = await this.prisma.order.findMany({
      where: {
        tenantId: tid,
        createdAt: { gte: since },
        status: { not: 'CANCELLED' },
      },
      select: { createdAt: true },
    });

    // 7 días × 24 horas
    const cells: number[][] = Array.from({ length: 7 }, () =>
      Array(24).fill(0),
    );
    for (const o of orders) {
      const d = new Date(o.createdAt);
      cells[d.getDay()][d.getHours()] += 1;
    }
    let max = 0;
    for (const row of cells) for (const v of row) if (v > max) max = v;
    return {
      days: ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'],
      cells,
      max,
      total: orders.length,
    };
  }

  /**
   * Devuelve qué pasos del onboarding inicial completó el tenant. Se usa para
   * mostrar el "Quick Start" en /app y guiar a tenants nuevos.
   */
  async onboardingStatus(user: AuthUser, tenantIdParam?: string) {
    const tid = user.role === 'SUPER_ADMIN' ? tenantIdParam : user.tenantId ?? undefined;
    if (!tid) throw new ForbiddenException();

    const t = await this.prisma.tenant.findUnique({
      where: { id: tid },
      select: {
        brandName: true,
        logoUrl: true,
        whatsappPhone: true,
        primaryColor: true,
        storefront: { select: { description: true, isPublished: true } },
      },
    });
    if (!t) throw new ForbiddenException();

    const [products, cards, customers, locations, orders, automations] =
      await Promise.all([
        this.prisma.product.count({ where: { tenantId: tid } }),
        this.prisma.card.count({ where: { tenantId: tid } }),
        this.prisma.customer.count({ where: { tenantId: tid } }),
        this.prisma.location.count({ where: { tenantId: tid, isActive: true } }),
        this.prisma.order.count({ where: { tenantId: tid } }),
        this.prisma.automationRule.count({ where: { tenantId: tid } }),
      ]);

    const items = [
      {
        key: 'brand',
        label: 'Configura tu marca',
        sub: 'Logo, colores y descripción',
        done: !!t.logoUrl && !!t.storefront?.description,
        href: '/app/storefront',
      },
      {
        key: 'whatsapp',
        label: 'Conecta tu WhatsApp',
        sub: 'Por donde te llegan los pedidos',
        done: !!t.whatsappPhone,
        href: '/app/settings',
      },
      {
        key: 'product',
        label: 'Crea tu primer producto',
        sub: 'Foto, precio, descripción',
        done: products > 0,
        href: '/app/menu',
      },
      {
        key: 'card',
        label: 'Crea tu tarjeta de fidelización',
        sub: 'Sellos, puntos o descuentos',
        done: cards > 0,
        href: '/app/cards/new',
      },
      {
        key: 'location',
        label: 'Agrega tu ubicación',
        sub: 'Para que clientes te encuentren',
        done: locations > 0,
        href: '/app/locations',
      },
      {
        key: 'share',
        label: 'Comparte tu link público',
        sub: 'Imprime el cartel QR para tus mesas',
        done: orders > 0, // proxy: si hay un pedido, ya compartió
        href: '/app/storefront/poster',
      },
      {
        key: 'customer',
        label: 'Recibe tu primer cliente',
        sub: 'Vía pedido o registro manual',
        done: customers > 0,
        href: '/app/customers',
      },
    ];

    const completedCount = items.filter((i) => i.done).length;
    const totalCount = items.length;
    const percent = Math.round((completedCount / totalCount) * 100);

    return {
      items,
      completedCount,
      totalCount,
      percent,
      complete: completedCount === totalCount,
    };
  }

  /**
   * Métricas granulares de UNA tarjeta específica.
   * KPIs + frecuencia 30d + embudo de fidelización + top clientes +
   * stats por tipo (CASHBACK saldo emitido/canjeado, POINTS, MEMBERSHIP
   * distribución por tier, etc).
   */
  async cardMetrics(user: AuthUser, cardId: string) {
    const card = await this.prisma.card.findUnique({
      where: { id: cardId },
      select: {
        id: true,
        tenantId: true,
        type: true,
        stampsRequired: true,
        visitsRequired: true,
        cashbackPercent: true,
        rewardText: true,
        tiers: true,
      },
    });
    if (!card) throw new ForbiddenException('Card not found');
    if (user.role !== 'SUPER_ADMIN' && user.tenantId !== card.tenantId) {
      throw new ForbiddenException();
    }

    const since30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const since7 = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    // Trayemos todos los pases de la card para hacer agregados in-memory
    // (más simple que groupBy con condicionales por tipo).
    const passes = await this.prisma.pass.findMany({
      where: { cardId },
      select: {
        id: true,
        customerId: true,
        status: true,
        stampsCount: true,
        pointsBalance: true,
        cashbackBalance: true,
        visitsCount: true,
        currentTier: true,
        tierProgress: true,
        issuedAt: true,
        lastActivityAt: true,
        walletPlatform: true,
        customer: { select: { id: true, fullName: true } },
      },
    });

    const totalPasses = passes.length;
    const activePasses = passes.filter((p) => p.status === 'ACTIVE').length;
    const completedPasses = passes.filter((p) => p.status === 'COMPLETED').length;
    const revokedPasses = passes.filter((p) => p.status === 'REVOKED').length;
    const activeLast30 = passes.filter(
      (p) => p.lastActivityAt && p.lastActivityAt >= since30,
    ).length;
    const inactiveLast30 = passes.filter(
      (p) => p.status === 'ACTIVE' && (!p.lastActivityAt || p.lastActivityAt < since30),
    ).length;
    const newLast7 = passes.filter((p) => p.issuedAt >= since7).length;

    // Stamps recientes para frecuencia + redenciones + top clientes
    const stamps = await this.prisma.stamp.findMany({
      where: { passId: { in: passes.map((p) => p.id) } },
      select: {
        id: true,
        action: true,
        amount: true,
        purchaseAmount: true,
        customerId: true,
        passId: true,
        createdAt: true,
      },
    });

    const totalScans = stamps.length;
    const redemptions = stamps.filter((s) => s.action === 'REDEEM').length;
    const scansLast30 = stamps.filter((s) => s.createdAt >= since30).length;

    // Frecuencia diaria (últimos 30 días)
    const dailyMap = new Map<string, number>();
    for (let i = 0; i < 30; i++) {
      const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
      const key = d.toISOString().slice(0, 10);
      dailyMap.set(key, 0);
    }
    for (const s of stamps) {
      if (s.createdAt < since30) continue;
      const key = s.createdAt.toISOString().slice(0, 10);
      if (dailyMap.has(key)) {
        dailyMap.set(key, (dailyMap.get(key) ?? 0) + 1);
      }
    }
    const scansByDay = Array.from(dailyMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, count]) => ({ date, count }));

    // Top 10 clientes por scans + revenue acumulado por cliente
    const scansByCustomer = new Map<
      string,
      {
        customerId: string;
        fullName: string;
        scans: number;
        revenue: number;
        lastVisit: Date | null;
      }
    >();
    for (const p of passes) {
      scansByCustomer.set(p.customer.id, {
        customerId: p.customer.id,
        fullName: p.customer.fullName,
        scans: 0,
        revenue: 0,
        lastVisit: p.lastActivityAt,
      });
    }
    for (const s of stamps) {
      const entry = scansByCustomer.get(s.customerId);
      if (entry) {
        entry.scans += 1;
        if (s.purchaseAmount) entry.revenue += Number(s.purchaseAmount);
        if (!entry.lastVisit || s.createdAt > entry.lastVisit) {
          entry.lastVisit = s.createdAt;
        }
      }
    }
    const topCustomers = Array.from(scansByCustomer.values())
      .filter((c) => c.scans > 0)
      .sort((a, b) => b.scans - a.scans)
      .slice(0, 10)
      .map((c) => ({ ...c, revenue: Math.round(c.revenue) }));
    const topByRevenue = Array.from(scansByCustomer.values())
      .filter((c) => c.revenue > 0)
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 10)
      .map((c) => ({ ...c, revenue: Math.round(c.revenue) }));

    // Revenue agregado de scans con purchaseAmount (STAMP/VISIT en cards
    // de fidelización) + por día para el chart.
    const purchaseStamps = stamps.filter(
      (s) => s.purchaseAmount && Number(s.purchaseAmount) > 0,
    );
    const totalRevenue = purchaseStamps.reduce(
      (sum, s) => sum + Number(s.purchaseAmount),
      0,
    );
    const revenueLast30 = purchaseStamps
      .filter((s) => s.createdAt >= since30)
      .reduce((sum, s) => sum + Number(s.purchaseAmount), 0);
    const avgTicket =
      purchaseStamps.length > 0
        ? Math.round(totalRevenue / purchaseStamps.length)
        : 0;
    const revenueByDay = (() => {
      const m = new Map<string, number>();
      for (let i = 0; i < 30; i++) {
        const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
        m.set(d.toISOString().slice(0, 10), 0);
      }
      for (const s of purchaseStamps) {
        if (s.createdAt < since30) continue;
        const key = s.createdAt.toISOString().slice(0, 10);
        if (m.has(key)) {
          m.set(key, (m.get(key) ?? 0) + Number(s.purchaseAmount));
        }
      }
      return Array.from(m.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, amount]) => ({ date, amount: Math.round(amount) }));
    })();

    // Embudo de fidelización (solo aplica a STAMPS/HYBRID/VISITS)
    const required =
      card.type === 'VISITS'
        ? card.visitsRequired ?? 10
        : card.stampsRequired ?? 10;
    const isProgressType =
      card.type === 'STAMPS' || card.type === 'HYBRID' || card.type === 'VISITS';
    let funnel: Array<{ key: string; label: string; count: number; pct: number }> = [];
    if (isProgressType) {
      const counterField = (p: typeof passes[number]) =>
        card.type === 'VISITS' ? p.visitsCount : p.stampsCount;
      const emitted = totalPasses;
      const firstStamp = passes.filter((p) => counterField(p) >= 1).length;
      const halfway = passes.filter((p) => counterField(p) >= Math.ceil(required / 2)).length;
      const completed = passes.filter((p) => counterField(p) >= required).length;
      const redeemed = redemptions;
      const pct = (n: number, base: number) =>
        base === 0 ? 0 : Math.round((n / base) * 1000) / 10;
      funnel = [
        { key: 'emitted', label: 'Emitidos', count: emitted, pct: 100 },
        { key: 'firstStamp', label: 'Con ≥1 sello/visita', count: firstStamp, pct: pct(firstStamp, emitted) },
        { key: 'halfway', label: '≥50% del progreso', count: halfway, pct: pct(halfway, emitted) },
        { key: 'completed', label: 'Cartón completo', count: completed, pct: pct(completed, emitted) },
        { key: 'redeemed', label: 'Premio canjeado', count: redeemed, pct: pct(redeemed, emitted) },
      ];
    }

    // Stats por tipo
    const byType: Record<string, any> = {};
    if (card.type === 'CASHBACK') {
      const cashbackAdded = stamps
        .filter((s) => s.action === 'CASHBACK_ADD')
        .reduce((sum, s) => sum + Number(s.amount), 0);
      const cashbackRedeemed = stamps
        .filter((s) => s.action === 'CASHBACK_REDEEM')
        .reduce((sum, s) => sum + Number(s.amount), 0);
      const balanceTotal = passes.reduce(
        (s, p) => s + Number(p.cashbackBalance),
        0,
      );
      byType.cashback = {
        totalAdded: Math.round(cashbackAdded),
        totalRedeemed: Math.round(cashbackRedeemed),
        balanceOutstanding: Math.round(balanceTotal),
      };
    }
    if (card.type === 'POINTS') {
      const pointsAdded = stamps
        .filter((s) => s.action === 'POINTS_ADD')
        .reduce((sum, s) => sum + Number(s.amount), 0);
      const pointsRedeemed = stamps
        .filter((s) => s.action === 'POINTS_DEDUCT')
        .reduce((sum, s) => sum + Number(s.amount), 0);
      const balanceTotal = passes.reduce(
        (s, p) => s + Number(p.pointsBalance),
        0,
      );
      byType.points = {
        totalAdded: Math.round(pointsAdded),
        totalRedeemed: Math.round(pointsRedeemed),
        balanceOutstanding: Math.round(balanceTotal),
      };
    }
    if (card.type === 'MEMBERSHIP') {
      const tiersList = (card.tiers as any[]) ?? [];
      const distribution: Record<string, number> = { 'Sin tier': 0 };
      for (const t of tiersList) distribution[t.name] = 0;
      for (const p of passes) {
        const key = p.currentTier || 'Sin tier';
        distribution[key] = (distribution[key] ?? 0) + 1;
      }
      const avgProgress = totalPasses
        ? Math.round(passes.reduce((s, p) => s + Number(p.tierProgress), 0) / totalPasses)
        : 0;
      byType.membership = {
        distribution: Object.entries(distribution).map(([name, count]) => ({
          name,
          count,
        })),
        avgTierProgress: avgProgress,
      };
    }
    if (isProgressType) {
      // Tiempo promedio para completar (issuedAt → completedAt aprox)
      const completedPassIds = passes
        .filter((p) => {
          const counter = card.type === 'VISITS' ? p.visitsCount : p.stampsCount;
          return counter >= required;
        })
        .map((p) => p.id);
      // lastActivityAt como proxy de "completado" (cuando alcanzó el target)
      const daysToComplete = passes
        .filter((p) => completedPassIds.includes(p.id) && p.lastActivityAt)
        .map(
          (p) =>
            (p.lastActivityAt!.getTime() - p.issuedAt.getTime()) /
            (24 * 60 * 60 * 1000),
        );
      const avgDays = daysToComplete.length
        ? Math.round(
            (daysToComplete.reduce((s, d) => s + d, 0) / daysToComplete.length) * 10,
          ) / 10
        : null;
      byType.progress = {
        completionRate:
          totalPasses === 0
            ? 0
            : Math.round((completedPassIds.length / totalPasses) * 1000) / 10,
        avgDaysToComplete: avgDays,
      };
    }

    // Pases nuevos por día (últimos 30d) — para gráfico de adquisición
    const newPassMap = new Map<string, number>();
    for (let i = 0; i < 30; i++) {
      const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
      const key = d.toISOString().slice(0, 10);
      newPassMap.set(key, 0);
    }
    for (const p of passes) {
      if (p.issuedAt < since30) continue;
      const key = p.issuedAt.toISOString().slice(0, 10);
      if (newPassMap.has(key)) {
        newPassMap.set(key, (newPassMap.get(key) ?? 0) + 1);
      }
    }
    const newPassesByDay = Array.from(newPassMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, count]) => ({ date, count }));

    // Breakdown de plataforma wallet — sobre el total de passes de la card.
    const walletApple = passes.filter((p) => p.walletPlatform === 'APPLE').length;
    const walletGoogle = passes.filter((p) => p.walletPlatform === 'GOOGLE').length;
    const walletNone = passes.filter((p) => p.walletPlatform == null).length;

    return {
      cardId: card.id,
      cardType: card.type,
      walletPlatforms: {
        apple: walletApple,
        google: walletGoogle,
        none: walletNone,
        total: totalPasses,
      },
      kpis: {
        totalPasses,
        activePasses,
        completedPasses,
        revokedPasses,
        activeLast30,
        inactiveLast30,
        newLast7,
        totalScans,
        scansLast30,
        redemptions,
        avgScansPerCustomer:
          activePasses === 0
            ? 0
            : Math.round((totalScans / activePasses) * 10) / 10,
      },
      revenue: {
        total: Math.round(totalRevenue),
        last30: Math.round(revenueLast30),
        avgTicket,
        scansWithPurchase: purchaseStamps.length,
      },
      scansByDay,
      newPassesByDay,
      revenueByDay,
      funnel,
      topCustomers,
      topByRevenue,
      byType,
    };
  }
}
