import { ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { AuthUser } from '../common/decorators/current-user.decorator';

@Injectable()
export class MetricsService {
  constructor(private prisma: PrismaService) {}

  async global(user: AuthUser) {
    if (user.role !== 'SUPER_ADMIN') throw new ForbiddenException();
    const [tenants, activeTenants, passes, customers, orders30, pendingComm] =
      await Promise.all([
        this.prisma.tenant.count(),
        this.prisma.tenant.count({ where: { status: 'ACTIVE' } }),
        this.prisma.pass.count(),
        this.prisma.customer.count(),
        this.prisma.order.count({
          where: {
            createdAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
          },
        }),
        this.prisma.commission.aggregate({
          _sum: { amount: true },
          where: { status: 'PENDING' },
        }),
      ]);
    return {
      tenants,
      activeTenants,
      passes,
      customers,
      orders30,
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
    ] = await Promise.all([
      this.prisma.card.count({ where: { tenantId: tid } }),
      this.prisma.customer.count({ where: { tenantId: tid } }),
      this.prisma.pass.count({ where: { tenantId: tid } }),
      this.prisma.pass.count({
        where: { tenantId: tid, walletDevices: { some: {} } },
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
      stamps30,
      redemptions30,
      // v2 — comercial
      ordersToday,
      revenueToday: Number(ordersTodayAgg._sum.total ?? 0),
      orders30,
      revenue30: Number(orders30Agg._sum.total ?? 0),
      revenue7: Number(orders7Agg._sum.total ?? 0),
      avgTicket: Number(orders30Agg._avg.total ?? 0),
      pendingOrders,
      newCustomers30,
      recurringCustomers30,
      topProducts: allTopAreZero
        ? topByItems
        : topProducts.map((p) => ({
            id: p.id,
            name: p.name,
            count: p.timesOrdered,
            category: p.category.name,
          })),
    };
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
}
