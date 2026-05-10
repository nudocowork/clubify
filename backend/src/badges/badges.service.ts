import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { AuthUser } from '../common/decorators/current-user.decorator';

export type BadgeCriteria = {
  type:
    | 'SCANS_TOTAL'
    | 'CARDS_COMPLETED'
    | 'STREAK_DAYS'
    | 'CASHBACK_EARNED'
    | 'FIRST_VISIT'
    | 'BIRTHDAY'
    | 'CUSTOM';
  threshold?: number;
  // Si presente, solo cuenta para esa card específica.
  cardId?: string;
};

export type BadgeDto = {
  name: string;
  description?: string;
  icon?: string;
  color?: string;
  criteria?: BadgeCriteria;
  xpReward?: number;
  isActive?: boolean;
};

/**
 * Niveles del Customer (umbrales de XP).
 * Se calculan en backend a partir de customer.xpPoints.
 * Customizable a futuro vía Setting key 'gamification.levels'.
 */
export const LEVEL_THRESHOLDS = [
  { level: 1, name: 'Bronce', minXp: 0, color: '#CD7F32' },
  { level: 2, name: 'Plata', minXp: 100, color: '#9CA3AF' },
  { level: 3, name: 'Oro', minXp: 300, color: '#F59E0B' },
  { level: 4, name: 'Platino', minXp: 600, color: '#06B6D4' },
  { level: 5, name: 'Diamante', minXp: 1000, color: '#8B5CF6' },
];

export function levelFromXp(xp: number) {
  for (let i = LEVEL_THRESHOLDS.length - 1; i >= 0; i--) {
    if (xp >= LEVEL_THRESHOLDS[i].minXp) return LEVEL_THRESHOLDS[i];
  }
  return LEVEL_THRESHOLDS[0];
}

export function nextLevelFromXp(xp: number) {
  for (const l of LEVEL_THRESHOLDS) {
    if (xp < l.minXp) return l;
  }
  return null;
}

@Injectable()
export class BadgesService {
  constructor(private prisma: PrismaService) {}

  private resolveTenantId(user: AuthUser, tenantIdParam?: string) {
    if (user.role === 'SUPER_ADMIN') {
      if (!tenantIdParam) throw new ForbiddenException('tenantId required');
      return tenantIdParam;
    }
    if (!user.tenantId) throw new ForbiddenException();
    return user.tenantId;
  }

  list(user: AuthUser, tenantId?: string) {
    const tid = this.resolveTenantId(user, tenantId);
    return this.prisma.badge.findMany({
      where: { tenantId: tid },
      include: { _count: { select: { earned: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async get(user: AuthUser, id: string) {
    const b = await this.prisma.badge.findUnique({ where: { id } });
    if (!b) throw new NotFoundException('Badge');
    if (user.role !== 'SUPER_ADMIN' && b.tenantId !== user.tenantId) {
      throw new ForbiddenException();
    }
    return b;
  }

  create(user: AuthUser, dto: BadgeDto, tenantId?: string) {
    const tid = this.resolveTenantId(user, tenantId);
    return this.prisma.badge.create({
      data: {
        tenantId: tid,
        name: dto.name,
        description: dto.description ?? '',
        icon: dto.icon ?? '🏅',
        color: dto.color ?? '#F59E0B',
        criteria: (dto.criteria ?? { type: 'CUSTOM' }) as any,
        xpReward: dto.xpReward ?? 50,
        isActive: dto.isActive ?? true,
      },
    });
  }

  async update(user: AuthUser, id: string, dto: Partial<BadgeDto>) {
    await this.get(user, id);
    return this.prisma.badge.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.icon !== undefined && { icon: dto.icon }),
        ...(dto.color !== undefined && { color: dto.color }),
        ...(dto.criteria !== undefined && { criteria: dto.criteria as any }),
        ...(dto.xpReward !== undefined && { xpReward: dto.xpReward }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
      },
    });
  }

  async remove(user: AuthUser, id: string) {
    await this.get(user, id);
    await this.prisma.badge.delete({ where: { id } });
    return { ok: true };
  }

  /** Otorgar manualmente una badge a un cliente. */
  async award(user: AuthUser, badgeId: string, customerId: string) {
    const badge = await this.get(user, badgeId);
    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId },
      select: { tenantId: true, xpPoints: true },
    });
    if (!customer) throw new NotFoundException('Customer');
    if (customer.tenantId !== badge.tenantId) {
      throw new ForbiddenException('Customer belongs to other tenant');
    }
    const existing = await this.prisma.customerBadge.findUnique({
      where: { customerId_badgeId: { customerId, badgeId } },
    });
    if (existing) return { ok: true, alreadyEarned: true };
    await this.prisma.$transaction([
      this.prisma.customerBadge.create({
        data: { customerId, badgeId },
      }),
      this.prisma.customer.update({
        where: { id: customerId },
        data: { xpPoints: customer.xpPoints + (badge.xpReward ?? 0) },
      }),
    ]);
    return { ok: true, awarded: true };
  }
}
