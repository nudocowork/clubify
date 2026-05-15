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
        plan: { select: { name: true } },
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
      // Si el dueño desactivó el botón en /app/storefront, no mandamos
      // el número al frontend → la sección que renderiza el botón hace
      // un check `if (s.whatsappPhone)` y queda oculto sin tener que
      // tocar la lógica del front. El número sigue guardado en tenant
      // por si se reactiva más tarde.
      whatsappPhone:
        t.storefront?.whatsappButtonEnabled === false
          ? null
          : t.whatsappPhone,
      instagramUrl: t.instagramUrl,
      mapsUrl: t.mapsUrl,
      currency: t.currency,
      description: t.storefront?.description ?? '',
      heroImageUrl: t.storefront?.heroImageUrl ?? null,
      blocks: t.storefront?.blocks ?? [],
      theme: t.storefront?.theme ?? {},
      menuLayout: t.storefront?.menuLayout ?? 'CLASSIC',
      ordersEnabled: t.storefront?.ordersEnabled ?? true,
      popup:
        t.storefront?.popupEnabled && t.storefront?.popupImageUrl
          ? {
              imageUrl: t.storefront.popupImageUrl,
              cardId: t.storefront.popupCardId ?? null,
              delaySeconds: t.storefront.popupDelaySeconds ?? 10,
            }
          : null,
      planName: t.plan?.name ?? null,
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
        imageUrl: p.imageUrl,
        type: p.type,
        value: Number(p.value),
        originalPrice: p.originalPrice ? Number(p.originalPrice) : null,
        validUntil: p.validUntil,
      })),
    };
  }

  @Public()
  @Get(':slug/menu')
  async menu(@Param('slug') slug: string) {
    const t = await this.prisma.tenant.findUnique({
      where: { slug },
      select: {
        id: true,
        status: true,
        storefront: {
          select: {
            recommendedTagline: true,
            recommendedCoverConfig: true,
          },
        },
      },
    });
    if (!t || t.status === 'SUSPENDED')
      throw new NotFoundException('Negocio no disponible');

    // Trae categorías raíz con hijos (subsecciones) y productos en
    // ambos niveles. El front decide cómo renderizar — el nuevo layout
    // SECTIONS muestra el banner por sección y agrupa por subsección
    // dentro. El layout viejo (CLASSIC/GRID/etc) ignora subsections y
    // hace flatten.
    const categories = await this.prisma.category.findMany({
      where: { tenantId: t.id, isActive: true, parentId: null },
      orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
      include: {
        children: {
          where: { isActive: true },
          orderBy: { position: 'asc' },
          include: {
            products: {
              where: { isAvailable: true },
              orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
              include: {
                variants: { orderBy: { position: 'asc' } },
                extras: { where: { isAvailable: true } },
              },
            },
          },
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

    const mapProduct = (p: any) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      basePrice: Number(p.basePrice),
      imageUrl: p.imageUrl,
      tags: p.tags,
      isRecommended: p.isRecommended,
      variants: p.variants.map((v: any) => ({
        id: v.id,
        groupName: v.groupName,
        name: v.name,
        priceDelta: Number(v.priceDelta),
        isDefault: v.isDefault,
      })),
      extras: p.extras.map((e: any) => ({
        id: e.id,
        name: e.name,
        price: Number(e.price),
        maxQty: e.maxQty,
      })),
    });

    const mapped = categories.map((c) => ({
      id: c.id,
      name: c.name,
      slug: c.slug,
      description: c.description,
      imageUrl: c.imageUrl,
      tagline: c.tagline,
      coverConfig: c.coverConfig,
      products: c.products.map(mapProduct),
      subsections: (c.children ?? []).map((sub: any) => ({
        id: sub.id,
        name: sub.name,
        slug: sub.slug,
        description: sub.description,
        imageUrl: sub.imageUrl,
        tagline: sub.tagline,
        coverConfig: sub.coverConfig,
        products: (sub.products ?? []).map(mapProduct),
      })),
    }));

    // Sección virtual "Recomendados" arriba de todo. Recoge productos
    // isRecommended de TODAS las categorías (raíz + hijas). Si no hay
    // ninguno, no se incluye la sección.
    const allProducts = categories.flatMap((c) => [
      ...c.products,
      ...(c.children ?? []).flatMap((sub: any) => sub.products ?? []),
    ]);
    const recommended = allProducts
      .filter((p: any) => p.isRecommended)
      .map(mapProduct);

    if (recommended.length > 0) {
      return [
        {
          id: '__recommended__',
          name: 'Recomendados',
          slug: 'recomendados',
          description: 'Lo más pedido por nuestros clientes.',
          imageUrl: null,
          // Cover editable desde /app/menu (botón 🎨 en la entrada
          // virtual "Recomendados"). Si el tenant no editó, queda null
          // y el frontend usa el header default minimal.
          tagline: t.storefront?.recommendedTagline ?? null,
          coverConfig: t.storefront?.recommendedCoverConfig ?? null,
          products: recommended,
          subsections: [],
        },
        ...mapped,
      ];
    }

    return mapped;
  }
}
