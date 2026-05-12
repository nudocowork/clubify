import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, QuotePlan } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';

export type CreateQuoteInput = {
  customerName: string;
  businessName: string;
  phone?: string | null;
  email?: string | null;
  plan: QuotePlan;
  templateSlug?: string | null;
};

export type ListQuotesFilters = {
  plan?: QuotePlan;
  templateSlug?: string;
  advisorId?: string;
  search?: string;
  /** ISO date — inclusive desde el inicio del día. */
  from?: string;
  /** ISO date — exclusive (filter < end-of-day del valor). */
  to?: string;
  take?: number;
  skip?: number;
  /** Si true, incluye archivadas; false/omit = solo activas. 'only' = solo archivadas. */
  archived?: 'include' | 'only' | 'exclude';
};

@Injectable()
export class QuotesService {
  constructor(
    private prisma: PrismaService,
    private settings: SettingsService,
  ) {}

  async create(advisorUserId: string, input: CreateQuoteInput) {
    const [advisor, pricing] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: advisorUserId },
        select: { id: true, fullName: true, email: true },
      }),
      this.settings.getPricing(),
    ]);
    if (!advisor) throw new NotFoundException('Asesor no encontrado');

    const priceSnapshot =
      input.plan === 'ELITE' ? pricing.eliteCost : pricing.proCost;

    return this.prisma.quote.create({
      data: {
        customerName: input.customerName.trim(),
        businessName: input.businessName.trim(),
        phone: input.phone?.trim() || null,
        email: input.email?.trim() || null,
        plan: input.plan,
        templateSlug: input.templateSlug?.trim() || null,
        advisorId: advisor.id,
        advisorName: advisor.fullName || advisor.email,
        priceSnapshot: new Prisma.Decimal(priceSnapshot),
        currencySnapshot: pricing.currency,
      },
    });
  }

  async list(filters: ListQuotesFilters = {}) {
    const where: Prisma.QuoteWhereInput = {};
    if (filters.plan) where.plan = filters.plan;
    if (filters.templateSlug) where.templateSlug = filters.templateSlug;
    if (filters.advisorId) where.advisorId = filters.advisorId;
    // Filtro archivadas: por defecto solo activas. 'include' trae las dos,
    // 'only' solo las archivadas (para vista dedicada).
    const archivedMode = filters.archived ?? 'exclude';
    if (archivedMode === 'exclude') where.archivedAt = null;
    else if (archivedMode === 'only') where.archivedAt = { not: null };
    if (filters.search) {
      const s = filters.search.trim();
      if (s) {
        where.OR = [
          { customerName: { contains: s, mode: 'insensitive' } },
          { businessName: { contains: s, mode: 'insensitive' } },
          { email: { contains: s, mode: 'insensitive' } },
          { phone: { contains: s } },
        ];
      }
    }
    if (filters.from || filters.to) {
      const range: { gte?: Date; lt?: Date } = {};
      if (filters.from) {
        const d = new Date(filters.from);
        if (!Number.isNaN(d.getTime())) {
          d.setHours(0, 0, 0, 0);
          range.gte = d;
        }
      }
      if (filters.to) {
        const d = new Date(filters.to);
        if (!Number.isNaN(d.getTime())) {
          // end-of-day exclusive
          d.setHours(0, 0, 0, 0);
          d.setDate(d.getDate() + 1);
          range.lt = d;
        }
      }
      if (range.gte || range.lt) where.createdAt = range;
    }
    const take = Math.min(Math.max(filters.take ?? 50, 1), 500);
    const skip = Math.max(filters.skip ?? 0, 0);
    const [items, total] = await Promise.all([
      this.prisma.quote.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take,
        skip,
      }),
      this.prisma.quote.count({ where }),
    ]);
    return { items, total, take, skip };
  }

  async getById(id: string) {
    const q = await this.prisma.quote.findUnique({
      where: { id },
      include: {
        convertedToTenant: {
          select: { id: true, slug: true, brandName: true },
        },
      },
    });
    if (!q) throw new NotFoundException('Cotización no encontrada');
    return q;
  }

  async remove(id: string) {
    await this.getById(id);
    await this.prisma.quote.delete({ where: { id } });
    return { ok: true };
  }

  /** Archive — saca la cotización del listing principal sin borrarla.
   *  Idempotente: si ya estaba archivada, no actualiza timestamp. */
  async archive(id: string) {
    const q = await this.prisma.quote.findUnique({
      where: { id },
      select: { id: true, archivedAt: true },
    });
    if (!q) throw new NotFoundException('Cotización no encontrada');
    if (q.archivedAt) return { ok: true, archivedAt: q.archivedAt };
    const updated = await this.prisma.quote.update({
      where: { id },
      data: { archivedAt: new Date() },
      select: { id: true, archivedAt: true },
    });
    return { ok: true, archivedAt: updated.archivedAt };
  }

  /** Unarchive — vuelve la cotización al listing activo. */
  async unarchive(id: string) {
    await this.getById(id);
    await this.prisma.quote.update({
      where: { id },
      data: { archivedAt: null },
      select: { id: true },
    });
    return { ok: true };
  }

  /** Incrementa el contador de descargas del PDF. Lo llaman tanto el panel
   * del super admin como la vista pública /q/<token> — el llamador resuelve
   * el id antes (en público se hace findUnique by publicToken). */
  async bumpPdfDownload(id: string) {
    const q = await this.prisma.quote.update({
      where: { id },
      data: {
        pdfDownloadCount: { increment: 1 },
        lastPdfDownloadAt: new Date(),
      },
      select: { id: true, pdfDownloadCount: true, lastPdfDownloadAt: true },
    });
    return q;
  }

  /** Bumpeo de CTA click — llamado desde el useEffect del signup cuando
   * detecta qt=<token>. Idempotencia para firstCtaClickedAt: solo se
   * setea si era null. Devuelve { ok } sin exponer counts (es público). */
  async bumpCtaClick(token: string) {
    const q = await this.prisma.quote.findUnique({
      where: { publicToken: token },
      select: { id: true, firstCtaClickedAt: true },
    });
    if (!q) return { ok: false as const };
    const isFirst = q.firstCtaClickedAt === null;
    await this.prisma.quote.update({
      where: { id: q.id },
      data: {
        ctaClickCount: { increment: 1 },
        lastCtaClickedAt: new Date(),
        ...(isFirst ? { firstCtaClickedAt: new Date() } : {}),
      },
      select: { id: true },
    });
    return { ok: true as const };
  }

  /**
   * Vista pública del cliente — accesible sin auth via /q/<token>.
   * NO expone advisorId, phone ni email del propio cliente; sí el nombre
   * del asesor para que el cliente sepa con quién hablar.
   */
  async getPublicByToken(token: string) {
    const q = await this.prisma.quote.findUnique({
      where: { publicToken: token },
      select: {
        id: true,
        publicToken: true,
        customerName: true,
        businessName: true,
        plan: true,
        templateSlug: true,
        advisorName: true,
        priceSnapshot: true,
        currencySnapshot: true,
        createdAt: true,
        firstViewedAt: true,
      },
    });
    if (!q) throw new NotFoundException('Cotización no encontrada');

    // Bump de engagement fire-and-forget. No await — si la DB tiene un
    // hipo, el cliente igual ve la cotización. Idempotencia para
    // firstViewedAt: solo se setea si era null.
    const isFirstView = q.firstViewedAt === null;
    this.prisma.quote
      .update({
        where: { id: q.id },
        data: {
          viewCount: { increment: 1 },
          lastViewedAt: new Date(),
          ...(isFirstView ? { firstViewedAt: new Date() } : {}),
        },
        select: { id: true },
      })
      .catch(() => null);

    // No exponemos id, viewCount ni firstViewedAt al cliente — son
    // métricas internas para el asesor. Devolvemos solo lo que la página
    // necesita renderizar.
    const { id: _id, firstViewedAt: _fv, ...publicData } = q;
    return publicData;
  }

  /** Métricas del CRM para el header del listing + sección Insights. */
  async stats() {
    const since30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    // 6 meses atrás (incluyendo el actual) — usamos primer día del mes
    // para garantizar buckets enteros y comparables.
    const monthsBack = 6;
    const since6mo = new Date();
    since6mo.setHours(0, 0, 0, 0);
    since6mo.setDate(1);
    since6mo.setMonth(since6mo.getMonth() - (monthsBack - 1));

    const [
      total,
      byPlan,
      byAdvisor,
      last30dCount,
      byTemplate,
      monthlyRows,
      totalConverted,
      convertedByAdvisor,
      // Funnel cumulativo: cada count es subset del anterior. Ej.
      // 100 sent → 60 viewed → 15 hot → 5 converted.
      funnelViewed,
      funnelHot,
    ] = await Promise.all([
      this.prisma.quote.count(),
      this.prisma.quote.groupBy({
        by: ['plan'],
        _count: { _all: true },
        _sum: { priceSnapshot: true },
      }),
      this.prisma.quote.groupBy({
        by: ['advisorId', 'advisorName'],
        _count: { _all: true },
        orderBy: { _count: { advisorId: 'desc' } },
        take: 10,
      }),
      this.prisma.quote.count({ where: { createdAt: { gte: since30 } } }),
      this.prisma.quote.groupBy({
        by: ['templateSlug'],
        _count: { _all: true },
        orderBy: { _count: { templateSlug: 'desc' } },
        take: 10,
      }),
      this.prisma.quote.findMany({
        where: { createdAt: { gte: since6mo } },
        select: { createdAt: true, plan: true },
      }),
      // Total convertido global — para conversion rate del header.
      this.prisma.quote.count({ where: { convertedAt: { not: null } } }),
      // Convertidos por asesor — alimenta la conversion rate por asesor.
      this.prisma.quote.groupBy({
        by: ['advisorId'],
        where: { convertedAt: { not: null } },
        _count: { _all: true },
      }),
      this.prisma.quote.count({ where: { viewCount: { gt: 0 } } }),
      this.prisma.quote.count({ where: { ctaClickCount: { gt: 0 } } }),
    ]);

    // Map advisorId → convertedCount para mergear con byAdvisor sin
    // pegarle al DB de nuevo.
    const convertedMap = new Map<string | null, number>();
    for (const row of convertedByAdvisor) {
      convertedMap.set(row.advisorId, row._count._all);
    }

    // Construcción de buckets mensuales (key YYYY-MM)
    const buckets = new Map<string, { elite: number; pro: number; total: number }>();
    for (let i = 0; i < monthsBack; i++) {
      const d = new Date(since6mo);
      d.setMonth(d.getMonth() + i);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      buckets.set(key, { elite: 0, pro: 0, total: 0 });
    }
    for (const row of monthlyRows) {
      const d = new Date(row.createdAt);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const b = buckets.get(key);
      if (!b) continue;
      b.total += 1;
      if (row.plan === 'PRO') b.pro += 1;
      else b.elite += 1;
    }
    const byMonth = Array.from(buckets.entries()).map(([key, v]) => ({
      key,
      total: v.total,
      elite: v.elite,
      pro: v.pro,
    }));

    return {
      total,
      last30dCount,
      totalConverted,
      // Conversion rate global — % de cotizaciones que terminaron en signup.
      conversionRate: total > 0 ? totalConverted / total : 0,
      funnel: {
        sent: total,
        viewed: funnelViewed,
        hot: funnelHot,
        converted: totalConverted,
      },
      byPlan: byPlan.map((b) => ({
        plan: b.plan,
        count: b._count._all,
        // priceSnapshot suma como Decimal → string para evitar precisión flotante en transporte.
        sumPrice: b._sum.priceSnapshot ? String(b._sum.priceSnapshot) : '0',
      })),
      byAdvisor: byAdvisor.map((b) => {
        const converted = convertedMap.get(b.advisorId) ?? 0;
        return {
          advisorId: b.advisorId,
          advisorName: b.advisorName,
          count: b._count._all,
          convertedCount: converted,
          conversionRate: b._count._all > 0 ? converted / b._count._all : 0,
        };
      }),
      byTemplate: byTemplate.map((b) => ({
        templateSlug: b.templateSlug,
        count: b._count._all,
      })),
      byMonth,
    };
  }
}
