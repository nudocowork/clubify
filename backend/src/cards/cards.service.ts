import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { CardType } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { AuthUser } from '../common/decorators/current-user.decorator';

export type CardDto = {
  type: CardType;
  name: string;
  description?: string;
  terms?: string;
  primaryColor?: string;
  secondaryColor?: string;
  logoUrl?: string;
  heroImageUrl?: string;
  iconUrl?: string;
  stampsRequired?: number;
  rewardText?: string;
  pointsPerCurrency?: number;
  discountPercent?: number;
  validFrom?: string;
  validUntil?: string;
  socialLinks?: Record<string, string>;
};

@Injectable()
export class CardsService {
  constructor(private prisma: PrismaService) {}

  private resolveTenantId(user: AuthUser, tenantIdParam?: string) {
    if (user.role === 'SUPER_ADMIN') {
      if (!tenantIdParam) throw new ForbiddenException('tenantId required for super admin');
      return tenantIdParam;
    }
    if (!user.tenantId) throw new ForbiddenException('User has no tenant');
    return user.tenantId;
  }

  list(user: AuthUser, tenantId?: string) {
    const tid = this.resolveTenantId(user, tenantId);
    return this.prisma.card.findMany({
      where: { tenantId: tid },
      include: { _count: { select: { passes: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async get(user: AuthUser, id: string) {
    const card = await this.prisma.card.findUnique({
      where: { id },
      include: { _count: { select: { passes: true } } },
    });
    if (!card) throw new NotFoundException('Card');
    if (user.role !== 'SUPER_ADMIN' && card.tenantId !== user.tenantId) {
      throw new ForbiddenException();
    }
    return card;
  }

  create(user: AuthUser, dto: CardDto, tenantId?: string) {
    const tid = this.resolveTenantId(user, tenantId);
    return this.prisma.card.create({
      data: {
        tenantId: tid,
        type: dto.type,
        name: dto.name,
        description: dto.description ?? '',
        terms: dto.terms ?? '',
        primaryColor: dto.primaryColor ?? '#0F3D2E',
        secondaryColor: dto.secondaryColor ?? '#2E7D5B',
        logoUrl: dto.logoUrl,
        heroImageUrl: dto.heroImageUrl,
        iconUrl: dto.iconUrl,
        stampsRequired: dto.stampsRequired,
        rewardText: dto.rewardText ?? '',
        pointsPerCurrency: dto.pointsPerCurrency,
        discountPercent: dto.discountPercent,
        validFrom: dto.validFrom ? new Date(dto.validFrom) : undefined,
        validUntil: dto.validUntil ? new Date(dto.validUntil) : undefined,
        socialLinks: dto.socialLinks ?? {},
      },
    });
  }

  async update(user: AuthUser, id: string, dto: Partial<CardDto>) {
    await this.get(user, id);
    return this.prisma.card.update({
      where: { id },
      data: {
        ...dto,
        validFrom: dto.validFrom ? new Date(dto.validFrom) : undefined,
        validUntil: dto.validUntil ? new Date(dto.validUntil) : undefined,
      },
    });
  }

  async remove(user: AuthUser, id: string) {
    await this.get(user, id);
    await this.prisma.card.delete({ where: { id } });
    return { ok: true };
  }
}
