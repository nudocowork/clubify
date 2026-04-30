import { Controller, Get, NotFoundException, Param } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { Public } from '../common/decorators/public.decorator';

@Controller('public/m')
export class PublicMenuController {
  constructor(private prisma: PrismaService) {}

  @Public()
  @Get(':slug')
  async storefront(@Param('slug') slug: string) {
    const t = await this.prisma.tenant.findUnique({
      where: { slug },
      include: {
        storefront: true,
        locations: { where: { isActive: true } },
      },
    });
    if (!t || t.status === 'SUSPENDED')
      throw new NotFoundException('Negocio no disponible');

    const promotions = await this.prisma.promotion.findMany({
      where: {
        tenantId: t.id,
        isActive: true,
        OR: [{ validUntil: null }, { validUntil: { gte: new Date() } }],
      },
      take: 6,
      orderBy: { createdAt: 'desc' },
    });

    return {
      id: t.id,
      slug: t.slug,
      brandName: t.brandName,
      logoUrl: t.logoUrl,
      primaryColor: t.primaryColor,
      secondaryColor: t.secondaryColor,
      whatsappPhone: t.whatsappPhone,
      instagramUrl: t.instagramUrl,
      mapsUrl: t.mapsUrl,
      currency: t.currency,
      description: t.storefront?.description ?? '',
      heroImageUrl: t.storefront?.heroImageUrl ?? null,
      blocks: t.storefront?.blocks ?? [],
      theme: t.storefront?.theme ?? {},
      locations: t.locations.map((l) => ({
        id: l.id,
        name: l.name,
        address: l.address,
        latitude: Number(l.latitude),
        longitude: Number(l.longitude),
      })),
      promotions: promotions.map((p) => ({
        id: p.id,
        name: p.name,
        description: p.description,
        type: p.type,
        value: Number(p.value),
        validUntil: p.validUntil,
      })),
    };
  }

  @Public()
  @Get(':slug/menu')
  async menu(@Param('slug') slug: string) {
    const t = await this.prisma.tenant.findUnique({
      where: { slug },
      select: { id: true, status: true },
    });
    if (!t || t.status === 'SUSPENDED')
      throw new NotFoundException('Negocio no disponible');

    const categories = await this.prisma.category.findMany({
      where: { tenantId: t.id, isActive: true, parentId: null },
      orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
      include: {
        children: {
          where: { isActive: true },
          orderBy: { position: 'asc' },
        },
        products: {
          where: { isAvailable: true },
          orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
          include: {
            variants: { orderBy: { position: 'asc' } },
            extras: { where: { isAvailable: true } },
          },
        },
      },
    });

    return categories.map((c) => ({
      id: c.id,
      name: c.name,
      slug: c.slug,
      description: c.description,
      products: c.products.map((p) => ({
        id: p.id,
        name: p.name,
        description: p.description,
        basePrice: Number(p.basePrice),
        imageUrl: p.imageUrl,
        tags: p.tags,
        variants: p.variants.map((v) => ({
          id: v.id,
          groupName: v.groupName,
          name: v.name,
          priceDelta: Number(v.priceDelta),
          isDefault: v.isDefault,
        })),
        extras: p.extras.map((e) => ({
          id: e.id,
          name: e.name,
          price: Number(e.price),
          maxQty: e.maxQty,
        })),
      })),
    }));
  }
}
