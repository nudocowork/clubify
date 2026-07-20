import {
  Controller,
  Get,
  Header,
  NotFoundException,
  Param,
  Query,
} from '@nestjs/common';

// Cache para endpoints públicos read-only (menú/storefront). El contenido es
// el mismo para todos los visitantes (varía solo por slug + locale en la URL),
// así que se puede cachear en el browser y en el CDN. stale-while-revalidate
// sirve la versión cacheada al instante mientras revalida en background →
// cargas casi instantáneas en visitas repetidas. Los cambios del menú tardan
// hasta ~3 min en propagarse (aceptable para un menú público).
const PUBLIC_CACHE =
  'public, max-age=30, s-maxage=180, stale-while-revalidate=600';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import {
  WhitelabelBrandService,
  ResolvedBrand,
} from '../whitelabel/whitelabel-brand.service';
import { Public } from '../common/decorators/public.decorator';
import { resolveMainSectionLabel } from '../common/business-categories';
import {
  TranslatableItem,
  TranslationService,
  normalizeLocale,
} from './translation.service';

// Forma exacta del tenant con sus relaciones para el storefront público.
// Mantener este `include` en sync con el findUnique de storefront() — si
// agregas una relación nueva, sumala aquí también para que TS la vea.
const STOREFRONT_TENANT_INCLUDE = {
  storefront: true,
  locations: { where: { isActive: true } },
  plan: { select: { name: true } },
} as const;

type StorefrontTenant = Prisma.TenantGetPayload<{
  include: typeof STOREFRONT_TENANT_INCLUDE;
}>;

type PublicLocation = {
  id: string;
  name: string;
  address: string | null;
  latitude: number;
  longitude: number;
};

type PublicPromotion = {
  id: string;
  name: string;
  description: string | null;
  imageUrl: string | null;
  type: string;
  value: number;
  originalPrice: number | null;
  validUntil: Date | null;
};

@Controller('public/m')
export class PublicMenuController {
  constructor(
    private prisma: PrismaService,
    private translation: TranslationService,
    private brand: WhitelabelBrandService,
  ) {}

  @Public()
  @Header('Cache-Control', PUBLIC_CACHE)
  @Get(':slug')
  async storefront(
    @Param('slug') slug: string,
    @Query('locale') localeRaw?: string,
  ) {
    const locale = normalizeLocale(localeRaw);
    const t = await this.prisma.tenant.findUnique({
      where: { slug },
      include: STOREFRONT_TENANT_INCLUDE,
    });
    if (!t || t.status === 'SUSPENDED')
      throw new NotFoundException('Negocio no disponible');

    // Marca blanca del negocio (fuente única). Hereda atribución/logo/favicon
    // /web de SU marca — nunca de otra ni de Clubify por defecto.
    const brand = await this.brand.resolveByWhiteLabelId(t.whiteLabelId);

    const promotions = await this.prisma.promotion.findMany({
      where: {
        tenantId: t.id,
        isActive: true,
        OR: [{ validUntil: null }, { validUntil: { gte: new Date() } }],
      },
      take: 6,
      orderBy: { createdAt: 'desc' },
    });

    const description = t.storefront?.description ?? '';
    const locations = t.locations.map((l) => ({
      id: l.id,
      name: l.name,
      address: l.address,
      latitude: Number(l.latitude),
      longitude: Number(l.longitude),
    }));
    const promotionsOut = promotions.map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      imageUrl: p.imageUrl,
      type: p.type,
      value: Number(p.value),
      originalPrice: p.originalPrice ? Number(p.originalPrice) : null,
      validUntil: p.validUntil,
    }));

    // Traduce description del storefront + nombres/descripciones de
    // promociones. brandName, addresses y locations.name son ruidosos
    // de traducir (NudoCowork → NudoCowork, calles → mismas calles) y
    // los saltamos.
    if (locale !== 'es') {
      const items: TranslatableItem[] = [];
      if (description) {
        items.push({
          entityType: 'storefront',
          entityId: t.id,
          field: 'description',
          text: description,
        });
      }
      for (const p of promotionsOut) {
        if (p.name) {
          items.push({
            entityType: 'promotion',
            entityId: p.id,
            field: 'name',
            text: p.name,
          });
        }
        if (p.description) {
          items.push({
            entityType: 'promotion',
            entityId: p.id,
            field: 'description',
            text: p.description,
          });
        }
      }
      if (items.length > 0) {
        const tr = await this.translation.translateMenuBatch(
          t.id,
          items,
          locale,
        );
        const get = (et: string, id: string, field: string, fb: string) =>
          tr.get(`${et}:${id}:${field}`) ?? fb;
        // mutación local (los map de arriba ya devolvieron objetos
        // nuevos, no toca cache de prisma)
        const newDescription = get(
          'storefront',
          t.id,
          'description',
          description,
        );
        for (const p of promotionsOut) {
          if (p.name) p.name = get('promotion', p.id, 'name', p.name);
          if (p.description)
            p.description = get('promotion', p.id, 'description', p.description);
        }
        return this.buildStorefrontResponse(t, newDescription, locations, promotionsOut, brand);
      }
    }

    return this.buildStorefrontResponse(t, description, locations, promotionsOut, brand);
  }

  private buildStorefrontResponse(
    t: StorefrontTenant,
    description: string,
    locations: PublicLocation[],
    promotions: PublicPromotion[],
    brand: ResolvedBrand,
  ) {
    return {
      id: t.id,
      slug: t.slug,
      brandName: t.brandName,
      // Marca blanca del negocio (atribución/logo/favicon/web). El storefront
      // muestra "Hecho con {brand.name}" y nunca branding de otra marca.
      brand: {
        name: brand.name,
        slug: brand.slug,
        websiteUrl: brand.websiteUrl,
        logoUrl: brand.logoUrl,
        iconUrl: brand.iconUrl,
        faviconUrl: brand.faviconUrl,
        primaryColor: brand.primaryColor,
        initial: brand.initial,
        attribution: brand.attribution,
      },
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
      currencySymbol: t.currencySymbol ?? null,
      country: t.country ?? 'CO',
      // Idioma del negocio (PDF 1254): el storefront lo usa como default para
      // los clientes de ESTE negocio (independiente de otros negocios).
      locale: (t as { locale?: string }).locale ?? 'es',
      description,
      heroImageUrl: t.storefront?.heroImageUrl ?? null,
      blocks: t.storefront?.blocks ?? [],
      theme: t.storefront?.theme ?? {},
      menuLayout: t.storefront?.menuLayout ?? 'CLASSIC',
      // Modos de menú independientes (digital tradicional + libro flipbook).
      // Default conservador: digital ON / book OFF mientras la columna no
      // exista en DB (instalación nueva); migration 20260625 setea valores
      // reales y vuelve `?? defaults` un no-op.
      digitalMenuEnabled: t.storefront?.digitalMenuEnabled ?? true,
      bookMenuEnabled: t.storefront?.bookMenuEnabled ?? false,
      ordersEnabled: t.storefront?.ordersEnabled ?? true,
      // Solo aplica a la vista delivery (link público sin ?mesa). La vista
      // mesa SIEMPRE se renderiza informativa, sin importar este flag.
      ordersDeliveryEnabled:
        (t.storefront?.ordersEnabled ?? true) &&
        (t.storefront?.ordersDeliveryEnabled ?? true),
      // PDF1145: fulfillment configurable por negocio. delivery = flag de
      // domicilio ya gateado; pickup/dineIn viven en theme.fulfillment (sin
      // migración, igual que theme.menuPopups). Default false → negocios sin
      // configurar solo ofrecen domicilio (comportamiento histórico).
      fulfillment: {
        delivery:
          (t.storefront?.ordersEnabled ?? true) &&
          (t.storefront?.ordersDeliveryEnabled ?? true),
        pickup: !!(t.storefront?.theme as any)?.fulfillment?.pickup,
        dineIn: !!(t.storefront?.theme as any)?.fulfillment?.dineIn,
      },
      pageBackgroundColor: t.storefront?.pageBackgroundColor ?? null,
      pageBackgroundType: t.storefront?.pageBackgroundType ?? null,
      pageBackgroundGradient: t.storefront?.pageBackgroundGradient ?? null,
      pageBackgroundImageUrl: t.storefront?.pageBackgroundImageUrl ?? null,
      logoBgColor: t.storefront?.logoBgColor ?? null,
      titleColor: t.storefront?.titleColor ?? null,
      descriptionColor: t.storefront?.descriptionColor ?? null,
      backButtonConfig: t.storefront?.backButtonConfig ?? null,
      popup:
        t.storefront?.popupEnabled && t.storefront?.popupImageUrl
          ? {
              imageUrl: t.storefront.popupImageUrl,
              cardId: t.storefront.popupCardId ?? null,
              delaySeconds: t.storefront.popupDelaySeconds ?? 10,
            }
          : null,
      // #5 (2026-06-17): popups MÚLTIPLES + programados. Viven en
      // theme.menuPopups (Json, sin migración). Devolvemos solo los habilitados
      // con imagen; el schedule (días/horario) lo evalúa el cliente con su hora
      // local. Si hay alguno activo, el front lo prioriza sobre `popup` (legacy).
      menuPopups: Array.isArray((t.storefront?.theme as any)?.menuPopups)
        ? ((t.storefront!.theme as any).menuPopups as any[])
            .filter((p) => p && p.enabled && typeof p.imageUrl === 'string' && p.imageUrl)
            .map((p) => ({
              id: String(p.id ?? ''),
              imageUrl: String(p.imageUrl),
              cardId: p.cardId ?? null,
              delaySeconds: Number.isFinite(Number(p.delaySeconds))
                ? Number(p.delaySeconds)
                : 10,
              schedule: p.schedule ?? null,
            }))
        : [],
      planName: t.plan?.name ?? null,
      // Label visible para tab principal y títulos ("Menú" / "Servicios" /
      // custom). Resuelto server-side: override del tenant > categoría > "Menú".
      mainSectionLabel: resolveMainSectionLabel(
        t.mainSectionLabelOverride,
        t.businessCategorySlug,
      ),
      locations,
      promotions,
    };
  }

  /**
   * Menú visual tipo libro / flipbook. Devuelve las secciones activas
   * del tenant con sus páginas (imageUrl + popup config) en el orden
   * en que se deben renderizar. El frontend storefront detecta
   * `menuLayout=FLIPBOOK` y llama aquí en lugar de `/menu`.
   *
   * Páginas inactivas y secciones inactivas se filtran server-side.
   * Si no hay secciones, devuelve { sections: [] } — el frontend cae
   * a un placeholder amable.
   */
  @Public()
  @Header('Cache-Control', PUBLIC_CACHE)
  @Get(':slug/menu-book')
  async menuBook(@Param('slug') slug: string) {
    const t = await this.prisma.tenant.findUnique({
      where: { slug },
      select: {
        id: true,
        status: true,
        storefront: {
          select: {
            // #29: orientación del swipe (HORIZONTAL|VERTICAL).
            bookMenuDirection: true,
            // M3: popup global del libro.
            bookPopupEnabled: true,
            bookPopupTitle: true,
            bookPopupDescription: true,
            bookPopupImageUrl: true,
            bookPopupButtonText: true,
            bookPopupButtonUrl: true,
            bookPopupButtonColor: true,
            bookPopupDelaySeconds: true,
            // M9: discriminator + payload CARD/IMAGE.
            bookPopupType: true,
            bookPopupCardId: true,
            bookPopupCardCtaLabel: true,
            bookPopupImageCaption: true,
          },
        },
      },
    });
    if (!t || t.status === 'SUSPENDED') {
      throw new NotFoundException('Negocio no disponible');
    }
    const sections = await this.prisma.menuBookSection.findMany({
      where: { tenantId: t.id, isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      include: {
        pages: {
          where: { isActive: true },
          orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
        },
      },
    });
    const sf = t.storefront;
    // M9: NULL → EXTERNAL_LINK por back compat con popups creados antes
    // del discriminator.
    const bookPopup =
      sf?.bookPopupEnabled
        ? {
            type: (sf.bookPopupType ?? 'EXTERNAL_LINK') as
              | 'EXTERNAL_LINK'
              | 'CARD'
              | 'IMAGE',
            title: sf.bookPopupTitle,
            description: sf.bookPopupDescription,
            imageUrl: sf.bookPopupImageUrl,
            buttonText: sf.bookPopupButtonText,
            buttonUrl: sf.bookPopupButtonUrl,
            buttonColor: sf.bookPopupButtonColor,
            cardId: sf.bookPopupCardId,
            cardCtaLabel: sf.bookPopupCardCtaLabel,
            imageCaption: sf.bookPopupImageCaption,
            delaySeconds: sf.bookPopupDelaySeconds ?? 5,
          }
        : null;
    return {
      // #29: el viewer usa esto para swipe horizontal o vertical.
      direction: sf?.bookMenuDirection === 'VERTICAL' ? 'VERTICAL' : 'HORIZONTAL',
      bookPopup,
      sections: sections.map((s) => ({
        id: s.id,
        title: s.title,
        // M3: popup que dispara al entrar a la sección. M9: incluye type.
        popup: s.popupEnabled
          ? {
              type: (s.popupType ?? 'EXTERNAL_LINK') as
                | 'EXTERNAL_LINK'
                | 'CARD'
                | 'IMAGE',
              title: s.popupTitle,
              description: s.popupDescription,
              imageUrl: s.popupImageUrl,
              buttonText: s.popupButtonText,
              buttonUrl: s.popupButtonUrl,
              buttonColor: s.popupButtonColor,
              cardId: s.popupCardId,
              cardCtaLabel: s.popupCardCtaLabel,
              imageCaption: s.popupImageCaption,
            }
          : null,
        pages: s.pages.map((p) => ({
          id: p.id,
          imageUrl: p.imageUrl,
          popup: p.popupEnabled
            ? {
                type: (p.popupType ?? 'EXTERNAL_LINK') as
                  | 'EXTERNAL_LINK'
                  | 'CARD'
                  | 'IMAGE',
                title: p.popupTitle,
                description: p.popupDescription,
                imageUrl: p.popupImageUrl,
                buttonText: p.popupButtonText,
                buttonUrl: p.popupButtonUrl,
                buttonColor: p.popupButtonColor,
                cardId: p.popupCardId,
                cardCtaLabel: p.popupCardCtaLabel,
                imageCaption: p.popupImageCaption,
              }
            : null,
        })),
      })),
    };
  }

  @Public()
  @Header('Cache-Control', PUBLIC_CACHE)
  @Get(':slug/menu')
  async menu(
    @Param('slug') slug: string,
    @Query('locale') localeRaw?: string,
    @Query('mode') modeRaw?: string,
  ) {
    const locale = normalizeLocale(localeRaw);
    // 'mesa' (default) o 'delivery' — filtra productos por flag de visibilidad.
    // Cualquier valor desconocido cae al default mesa.
    const mode = modeRaw === 'delivery' ? 'delivery' : 'mesa';
    const productAvailabilityFilter =
      mode === 'delivery'
        ? { isAvailable: true, availableForDelivery: true }
        : { isAvailable: true, availableForMesa: true };
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
              where: productAvailabilityFilter,
              orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
              include: {
                variants: { orderBy: { position: 'asc' } },
                extras: { where: { isAvailable: true } },
              },
            },
          },
        },
        products: {
          where: productAvailabilityFilter,
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
      priceMode: p.priceMode ?? 'FIXED',
      priceMax: p.priceMax != null ? Number(p.priceMax) : null,
      variantPriceMode: p.variantPriceMode ?? 'DELTA',
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

    // popupConfig solo viaja al cliente si está enabled — sin enabled
    // el frontend no tiene nada que hacer con esa data y evita exponer
    // configs en borrador.
    const mapPopup = (p: any) =>
      p && typeof p === 'object' && p.enabled ? p : null;

    // Bloque 2 (2026-06-12): productos huérfanos (categoryId=null).
    // Pueden existir porque (a) el dueño los creó sin categoría desde
    // /app/menu cuando no tenía categorías, o (b) la categoría fue
    // borrada después (FK SetNull). Los renderizamos en una sección
    // virtual "Otros" al final del menú.
    const orphanProducts = await this.prisma.product.findMany({
      where: {
        tenantId: t.id,
        categoryId: null,
        ...productAvailabilityFilter,
      },
      orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
      include: {
        variants: { orderBy: { position: 'asc' } },
        extras: { where: { isAvailable: true } },
      },
    });

    const mapped = categories
      .map((c) => {
        // Subsecciones se conservan solo si tienen ≥1 producto matching;
        // sino crean ruido visual (header + cero productos).
        const subsections = (c.children ?? [])
          .map((sub: any) => ({
            id: sub.id,
            name: sub.name,
            slug: sub.slug,
            description: sub.description,
            imageUrl: sub.imageUrl,
            tagline: sub.tagline,
            coverConfig: sub.coverConfig,
            popupConfig: mapPopup(sub.popupConfig),
            products: (sub.products ?? []).map(mapProduct),
          }))
          .filter((sub: any) => sub.products.length > 0);
        return {
          id: c.id,
          name: c.name,
          slug: c.slug,
          description: c.description,
          imageUrl: c.imageUrl,
          tagline: c.tagline,
          coverConfig: c.coverConfig,
          popupConfig: mapPopup(c.popupConfig),
          products: c.products.map(mapProduct),
          subsections,
        };
      })
      // Categorías raíz vacías (sin productos y sin subsecciones) tampoco
      // se devuelven: el menú filtrado por mode no debería mostrar headers
      // de categorías que no aportan nada al canal actual.
      .filter((c) => c.products.length > 0 || c.subsections.length > 0);

    // Sección virtual "Otros" para productos sin categoría (Bloque 2).
    // Va al FINAL del array `mapped` antes de los Recomendados.
    if (orphanProducts.length > 0) {
      mapped.push({
        id: '__uncategorized__',
        name: 'Otros',
        slug: 'otros',
        description: null,
        imageUrl: null,
        tagline: null,
        coverConfig: null,
        popupConfig: null,
        products: orphanProducts.map(mapProduct),
        subsections: [],
      });
    }

    // Sección virtual "Recomendados" arriba de todo. Recoge productos
    // isRecommended de TODAS las categorías (raíz + hijas) + huérfanos.
    // Si no hay ninguno, no se incluye la sección.
    const allProducts = [
      ...categories.flatMap((c) => [
        ...c.products,
        ...(c.children ?? []).flatMap((sub: any) => sub.products ?? []),
      ]),
      ...orphanProducts,
    ];
    const recommended = allProducts
      .filter((p: any) => p.isRecommended)
      .map(mapProduct);

    const full =
      recommended.length > 0
        ? [
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
              popupConfig: null,
              products: recommended,
              subsections: [],
            },
            ...mapped,
          ]
        : mapped;

    // Fast-path: locale=es es la fuente canónica; ningún tenant edita en
    // EN/PT en este Fase, así que devolvemos directo sin tocar nada.
    if (locale === 'es') return full;

    return this.applyTranslations(t.id, full, locale);
  }

  /**
   * Camina el árbol del menú, junta todos los strings traducibles (sin
   * duplicar identidad), pide traducciones al TranslationService (cache
   * + Claude) y devuelve un árbol nuevo con los textos sustituidos.
   * Mantiene el árbol original intacto.
   *
   * NOTA sobre la sección virtual `__recommended__`:
   *  - El TÍTULO de la sección ("Recomendados") y su descripción los
   *    traduce el frontend con i18n keys (Fase 1, sin tokens).
   *  - Los PRODUCTOS dentro sí se traducen en backend, pero reusan la
   *    misma cache key que sus categorías reales (productId es el
   *    mismo), entonces no duplican llamadas a Claude ni filas en
   *    MenuTranslation.
   */
  private async applyTranslations(
    tenantId: string,
    sections: any[],
    locale: string,
  ) {
    const items: TranslatableItem[] = [];

    const collectFromProduct = (p: any) => {
      if (p.name) {
        items.push({
          entityType: 'product',
          entityId: p.id,
          field: 'name',
          text: p.name,
        });
      }
      if (p.description) {
        items.push({
          entityType: 'product',
          entityId: p.id,
          field: 'description',
          text: p.description,
        });
      }
      for (const v of p.variants ?? []) {
        if (v.name) {
          items.push({
            entityType: 'variant',
            entityId: v.id,
            field: 'name',
            text: v.name,
          });
        }
        if (v.groupName) {
          items.push({
            entityType: 'variant',
            entityId: v.id,
            field: 'groupName',
            text: v.groupName,
          });
        }
      }
      for (const e of p.extras ?? []) {
        if (e.name) {
          items.push({
            entityType: 'extra',
            entityId: e.id,
            field: 'name',
            text: e.name,
          });
        }
      }
    };

    const collectFromCategory = (c: any) => {
      // Saltear sección virtual; el frontend la traduce con i18n keys.
      if (c.id === '__recommended__') {
        for (const p of c.products ?? []) collectFromProduct(p);
        return;
      }
      if (c.name) {
        items.push({
          entityType: 'category',
          entityId: c.id,
          field: 'name',
          text: c.name,
        });
      }
      if (c.description) {
        items.push({
          entityType: 'category',
          entityId: c.id,
          field: 'description',
          text: c.description,
        });
      }
      if (c.tagline) {
        items.push({
          entityType: 'category',
          entityId: c.id,
          field: 'tagline',
          text: c.tagline,
        });
      }
      for (const p of c.products ?? []) collectFromProduct(p);
      for (const sub of c.subsections ?? []) collectFromCategory(sub);
    };

    for (const c of sections) collectFromCategory(c);

    const tr = await this.translation.translateMenuBatch(
      tenantId,
      items,
      locale,
    );
    const get = (
      et: TranslatableItem['entityType'],
      id: string,
      field: TranslatableItem['field'],
      fallback: string | null,
    ) => tr.get(`${et}:${id}:${field}`) ?? fallback;

    const mapProduct = (p: any) => ({
      ...p,
      name: get('product', p.id, 'name', p.name) ?? p.name,
      description: get('product', p.id, 'description', p.description) ?? p.description,
      variants: (p.variants ?? []).map((v: any) => ({
        ...v,
        name: get('variant', v.id, 'name', v.name) ?? v.name,
        groupName: get('variant', v.id, 'groupName', v.groupName) ?? v.groupName,
      })),
      extras: (p.extras ?? []).map((e: any) => ({
        ...e,
        name: get('extra', e.id, 'name', e.name) ?? e.name,
      })),
    });

    const mapCategory = (c: any) => {
      if (c.id === '__recommended__') {
        return { ...c, products: (c.products ?? []).map(mapProduct) };
      }
      return {
        ...c,
        name: get('category', c.id, 'name', c.name) ?? c.name,
        description:
          c.description == null
            ? c.description
            : get('category', c.id, 'description', c.description),
        tagline:
          c.tagline == null
            ? c.tagline
            : get('category', c.id, 'tagline', c.tagline),
        products: (c.products ?? []).map(mapProduct),
        subsections: (c.subsections ?? []).map(mapCategory),
      };
    };

    return sections.map(mapCategory);
  }
}
