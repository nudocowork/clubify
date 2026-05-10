import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { CardType } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { AuthUser } from '../common/decorators/current-user.decorator';

export type CardDto = {
  type: CardType;
  name: string;
  description?: string;
  terms?: string;
  termsEnabled?: boolean;
  primaryColor?: string;
  secondaryColor?: string;
  stampActiveColor?: string | null;
  stampInactiveColor?: string | null;
  stampContourColor?: string | null;
  centerBgColor?: string | null;
  logoUrl?: string;
  heroImageUrl?: string;
  iconUrl?: string;
  stampsRequired?: number;
  rewardText?: string;
  pointsPerCurrency?: number;
  discountPercent?: number;
  validFrom?: string | null;
  validUntil?: string | null;
  validDaysAfterIssue?: number | null;
  locationId?: string | null;
  howToEarnText?: string;
  businessName?: string;
  rewardDescText?: string;
  stampEarnedMessage?: string;
  rewardEarnedMessage?: string;
  multiRewards?: Array<{ at: number; reward: string }>;
  activeLinks?: Array<{ type: string; url: string; label: string }>;
  socialLinks?: Record<string, string>;
  stampIcon?: string;
  isActive?: boolean;
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
      include: {
        _count: { select: { passes: true } },
        location: { select: { id: true, name: true } },
        utmLinks: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async get(user: AuthUser, id: string) {
    const card = await this.prisma.card.findUnique({
      where: { id },
      include: {
        _count: { select: { passes: true } },
        location: { select: { id: true, name: true } },
        utmLinks: true,
      },
    });
    if (!card) throw new NotFoundException('Card');
    if (user.role !== 'SUPER_ADMIN' && card.tenantId !== user.tenantId) {
      throw new ForbiddenException();
    }
    return card;
  }

  async create(user: AuthUser, dto: CardDto, tenantId?: string) {
    const tid = this.resolveTenantId(user, tenantId);
    // Validamos que la sede pertenezca al tenant si vino seteada.
    if (dto.locationId) {
      const loc = await this.prisma.location.findUnique({
        where: { id: dto.locationId },
        select: { tenantId: true },
      });
      if (!loc || loc.tenantId !== tid) {
        throw new ForbiddenException('Location does not belong to tenant');
      }
    }
    return this.prisma.card.create({
      data: {
        tenantId: tid,
        type: dto.type,
        name: dto.name,
        description: dto.description ?? '',
        terms: dto.terms ?? '',
        termsEnabled: dto.termsEnabled ?? true,
        primaryColor: dto.primaryColor ?? '#0F3D2E',
        secondaryColor: dto.secondaryColor ?? '#2E7D5B',
        stampActiveColor: dto.stampActiveColor ?? undefined,
        stampInactiveColor: dto.stampInactiveColor ?? undefined,
        stampContourColor: dto.stampContourColor ?? undefined,
        centerBgColor: dto.centerBgColor ?? undefined,
        logoUrl: dto.logoUrl,
        heroImageUrl: dto.heroImageUrl,
        iconUrl: dto.iconUrl,
        stampsRequired: dto.stampsRequired,
        rewardText: dto.rewardText ?? '',
        pointsPerCurrency: dto.pointsPerCurrency,
        discountPercent: dto.discountPercent,
        validFrom: dto.validFrom ? new Date(dto.validFrom) : undefined,
        validUntil: dto.validUntil ? new Date(dto.validUntil) : undefined,
        validDaysAfterIssue: dto.validDaysAfterIssue ?? undefined,
        locationId: dto.locationId ?? undefined,
        howToEarnText: dto.howToEarnText ?? '',
        businessName: dto.businessName ?? '',
        rewardDescText: dto.rewardDescText ?? '',
        stampEarnedMessage: dto.stampEarnedMessage ?? '',
        rewardEarnedMessage: dto.rewardEarnedMessage ?? '',
        multiRewards: (dto.multiRewards ?? []) as any,
        activeLinks: (dto.activeLinks ?? []) as any,
        socialLinks: dto.socialLinks ?? {},
        stampIcon: dto.stampIcon ?? '☕',
      },
    });
  }

  async update(user: AuthUser, id: string, dto: Partial<CardDto>) {
    const existing = await this.get(user, id);
    if (dto.locationId) {
      const loc = await this.prisma.location.findUnique({
        where: { id: dto.locationId },
        select: { tenantId: true },
      });
      if (!loc || loc.tenantId !== existing.tenantId) {
        throw new ForbiddenException('Location does not belong to tenant');
      }
    }
    // null en estos campos significa "borrar"; undefined = "no tocar".
    const data: any = { ...dto };
    if ('validFrom' in dto) {
      data.validFrom = dto.validFrom ? new Date(dto.validFrom) : null;
    }
    if ('validUntil' in dto) {
      data.validUntil = dto.validUntil ? new Date(dto.validUntil) : null;
    }
    if ('validDaysAfterIssue' in dto) {
      data.validDaysAfterIssue = dto.validDaysAfterIssue ?? null;
    }
    if ('locationId' in dto) {
      data.locationId = dto.locationId ?? null;
    }
    for (const k of [
      'stampActiveColor',
      'stampInactiveColor',
      'stampContourColor',
      'centerBgColor',
    ] as const) {
      if (k in dto) data[k] = dto[k] ?? null;
    }
    return this.prisma.card.update({ where: { id }, data });
  }

  async remove(user: AuthUser, id: string) {
    await this.get(user, id);
    await this.prisma.card.delete({ where: { id } });
    return { ok: true };
  }
}
