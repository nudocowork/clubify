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

  /** Métricas básicas para el header del CRM. */
  async stats() {
    const [total, byPlan, byAdvisor, last30dCount] = await Promise.all([
      this.prisma.quote.count(),
      this.prisma.quote.groupBy({
        by: ['plan'],
        _count: { _all: true },
      }),
      this.prisma.quote.groupBy({
        by: ['advisorId', 'advisorName'],
        _count: { _all: true },
        orderBy: { _count: { advisorId: 'desc' } },
        take: 10,
      }),
      this.prisma.quote.count({
        where: {
          createdAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
        },
      }),
    ]);
    return {
      total,
      last30dCount,
      byPlan: byPlan.map((b) => ({ plan: b.plan, count: b._count._all })),
      byAdvisor: byAdvisor.map((b) => ({
        advisorId: b.advisorId,
        advisorName: b.advisorName,
        count: b._count._all,
      })),
    };
  }
}
