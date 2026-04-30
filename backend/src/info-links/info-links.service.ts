import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { AuthUser } from '../common/decorators/current-user.decorator';

function slugify(s: string) {
  return (
    s
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '')
      .slice(0, 60) || `link-${Date.now().toString(36).slice(-6)}`
  );
}

export type InfoLinkDto = {
  title: string;
  subtitle?: string;
  slug?: string;
  heroImageUrl?: string;
  gallery?: string[];
  sections?: any[];
  buttons?: any[];
  theme?: any;
  isActive?: boolean;
};

@Injectable()
export class InfoLinksService {
  constructor(private prisma: PrismaService) {}

  private tid(user: AuthUser, override?: string) {
    if (user.role === 'SUPER_ADMIN') {
      if (!override) throw new ForbiddenException('tenantId required');
      return override;
    }
    if (!user.tenantId) throw new ForbiddenException();
    return user.tenantId;
  }

  list(user: AuthUser, override?: string) {
    const tid = this.tid(user, override);
    return this.prisma.infoLink.findMany({
      where: { tenantId: tid },
      orderBy: { updatedAt: 'desc' },
      include: { _count: { select: { events: true } } },
    });
  }

  async get(user: AuthUser, id: string) {
    const link = await this.prisma.infoLink.findUnique({ where: { id } });
    if (!link) throw new NotFoundException();
    if (user.role !== 'SUPER_ADMIN' && link.tenantId !== user.tenantId) {
      throw new ForbiddenException();
    }
    return link;
  }

  async create(user: AuthUser, dto: InfoLinkDto, override?: string) {
    const tid = this.tid(user, override);
    let slug = dto.slug ? slugify(dto.slug) : slugify(dto.title);
    // Asegurar unicidad
    let suffix = 0;
    while (
      await this.prisma.infoLink.findFirst({
        where: { tenantId: tid, slug: suffix === 0 ? slug : `${slug}-${suffix}` },
      })
    ) {
      suffix++;
    }
    if (suffix > 0) slug = `${slug}-${suffix}`;

    return this.prisma.infoLink.create({
      data: {
        tenantId: tid,
        slug,
        title: dto.title,
        subtitle: dto.subtitle,
        heroImageUrl: dto.heroImageUrl,
        gallery: (dto.gallery ?? []) as any,
        sections: (dto.sections ?? []) as any,
        buttons: (dto.buttons ?? []) as any,
        theme: (dto.theme ?? {}) as any,
        isActive: dto.isActive ?? true,
      },
    });
  }

  async update(user: AuthUser, id: string, dto: Partial<InfoLinkDto>) {
    await this.get(user, id);
    return this.prisma.infoLink.update({
      where: { id },
      data: {
        title: dto.title ?? undefined,
        subtitle: dto.subtitle === undefined ? undefined : dto.subtitle,
        heroImageUrl: dto.heroImageUrl === undefined ? undefined : dto.heroImageUrl,
        gallery: dto.gallery === undefined ? undefined : (dto.gallery as any),
        sections: dto.sections === undefined ? undefined : (dto.sections as any),
        buttons: dto.buttons === undefined ? undefined : (dto.buttons as any),
        theme: dto.theme === undefined ? undefined : (dto.theme as any),
        isActive: dto.isActive === undefined ? undefined : dto.isActive,
      },
    });
  }

  async remove(user: AuthUser, id: string) {
    await this.get(user, id);
    await this.prisma.infoLink.delete({ where: { id } });
    return { ok: true };
  }

  async stats(user: AuthUser, id: string) {
    await this.get(user, id);
    const since30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const events = await this.prisma.infoLinkEvent.findMany({
      where: { infoLinkId: id, createdAt: { gte: since30 } },
    });
    const counts = { view: 0, click_button: 0, qr_scan: 0 } as Record<string, number>;
    const buttonClicks = new Map<string, number>();
    for (const e of events) {
      counts[e.type] = (counts[e.type] ?? 0) + 1;
      if (e.type === 'click_button') {
        const label = (e.metadata as any)?.label ?? 'Sin etiqueta';
        buttonClicks.set(label, (buttonClicks.get(label) ?? 0) + 1);
      }
    }
    return {
      views: counts.view,
      qrScans: counts.qr_scan,
      buttonClicks: Object.fromEntries(buttonClicks),
      total: events.length,
    };
  }

  // ============ Público ============

  async getPublic(tenantSlug: string, linkSlug: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { slug: tenantSlug },
      select: {
        id: true,
        brandName: true,
        logoUrl: true,
        primaryColor: true,
        secondaryColor: true,
        whatsappPhone: true,
        instagramUrl: true,
        mapsUrl: true,
        slug: true,
        status: true,
      },
    });
    if (!tenant || tenant.status === 'SUSPENDED') {
      throw new NotFoundException('No disponible');
    }
    const link = await this.prisma.infoLink.findUnique({
      where: { tenantId_slug: { tenantId: tenant.id, slug: linkSlug } },
    });
    if (!link || !link.isActive) throw new NotFoundException('Link no disponible');

    // Incrementa views (best-effort, no bloquea respuesta)
    this.prisma.infoLink
      .update({ where: { id: link.id }, data: { views: { increment: 1 } } })
      .catch(() => null);
    this.prisma.infoLinkEvent
      .create({ data: { infoLinkId: link.id, type: 'view' } })
      .catch(() => null);

    return { tenant, link };
  }

  trackEvent(linkId: string, type: string, metadata: any = {}) {
    return this.prisma.infoLinkEvent
      .create({
        data: { infoLinkId: linkId, type, metadata },
      })
      .catch(() => null);
  }
}
