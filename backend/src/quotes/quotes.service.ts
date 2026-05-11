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
  take?: number;
  skip?: number;
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
    const take = Math.min(Math.max(filters.take ?? 50, 1), 200);
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
    const q = await this.prisma.quote.findUnique({ where: { id } });
    if (!q) throw new NotFoundException('Cotización no encontrada');
    return q;
  }

  async remove(id: string) {
    await this.getById(id);
    await this.prisma.quote.delete({ where: { id } });
    return { ok: true };
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
        publicToken: true,
        customerName: true,
        businessName: true,
        plan: true,
        templateSlug: true,
        advisorName: true,
        priceSnapshot: true,
        currencySnapshot: true,
        createdAt: true,
      },
    });
    if (!q) throw new NotFoundException('Cotización no encontrada');
    return q;
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

    const [total, byPlan, byAdvisor, last30dCount, byTemplate, monthlyRows] =
      await Promise.all([
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
      ]);

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
      byPlan: byPlan.map((b) => ({
        plan: b.plan,
        count: b._count._all,
        // priceSnapshot suma como Decimal → string para evitar precisión flotante en transporte.
        sumPrice: b._sum.priceSnapshot ? String(b._sum.priceSnapshot) : '0',
      })),
      byAdvisor: byAdvisor.map((b) => ({
        advisorId: b.advisorId,
        advisorName: b.advisorName,
        count: b._count._all,
      })),
      byTemplate: byTemplate.map((b) => ({
        templateSlug: b.templateSlug,
        count: b._count._all,
      })),
      byMonth,
    };
  }
}
