import { ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { AuthUser } from '../common/decorators/current-user.decorator';

export type StorefrontDto = {
  description?: string;
  heroImageUrl?: string;
  theme?: any;
  blocks?: any[];
  isPublished?: boolean;
  customDomain?: string | null;
};

@Injectable()
export class StorefrontService {
  constructor(private prisma: PrismaService) {}

  private tid(user: AuthUser, override?: string) {
    if (user.role === 'SUPER_ADMIN') {
      if (!override) throw new ForbiddenException('tenantId required');
      return override;
    }
    if (!user.tenantId) throw new ForbiddenException();
    return user.tenantId;
  }

  async get(user: AuthUser, override?: string) {
    const tid = this.tid(user, override);
    const sf = await this.prisma.storefront.upsert({
      where: { tenantId: tid },
      create: {
        tenantId: tid,
        description: '',
        theme: { primaryColor: '#6366F1' },
        blocks: [
          { type: 'hero' },
          { type: 'social' },
          { type: 'menu' },
          { type: 'cards' },
          { type: 'promotions' },
        ],
      },
      update: {},
    });
    return sf;
  }

  async update(user: AuthUser, dto: StorefrontDto, override?: string) {
    const tid = this.tid(user, override);
    const customDomain = this.normalizeDomain(dto.customDomain);
    return this.prisma.storefront.upsert({
      where: { tenantId: tid },
      create: {
        tenantId: tid,
        description: dto.description ?? '',
        heroImageUrl: dto.heroImageUrl,
        theme: dto.theme ?? {},
        blocks: dto.blocks ?? [],
        isPublished: dto.isPublished ?? true,
        customDomain,
      },
      update: {
        description: dto.description ?? undefined,
        heroImageUrl: dto.heroImageUrl ?? undefined,
        theme: dto.theme ?? undefined,
        blocks: dto.blocks ?? undefined,
        isPublished: dto.isPublished ?? undefined,
        customDomain: dto.customDomain === undefined ? undefined : customDomain,
      },
    });
  }

  /** Resuelve un host (Host header) al slug del tenant correspondiente. */
  async resolveHost(host: string) {
    const normalized = this.normalizeDomain(host);
    if (!normalized) return null;
    const sf = await this.prisma.storefront.findFirst({
      where: { customDomain: normalized, isPublished: true },
      include: { tenant: { select: { slug: true, brandName: true } } },
    });
    if (!sf) return null;
    return {
      slug: sf.tenant.slug,
      brandName: sf.tenant.brandName,
      customDomain: sf.customDomain,
    };
  }

  private normalizeDomain(d?: string | null) {
    if (d == null) return null;
    const trimmed = d
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\//, '')
      .replace(/\/.*$/, '')
      .replace(/:\d+$/, ''); // sin puerto
    return trimmed || null;
  }
}
