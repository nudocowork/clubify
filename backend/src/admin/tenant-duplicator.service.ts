import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { nanoid } from 'nanoid';
import { PrismaService } from '../common/prisma/prisma.service';
import { AuthService } from '../auth/auth.service';
import { AuditService } from '../audit/audit.service';

export type DuplicateStepStatus = 'ok' | 'error' | 'skip';

export type DuplicateStep = {
  name: string;
  status: DuplicateStepStatus;
  message?: string;
  count?: number;
};

export type DuplicateOpts = {
  sourceTenantId: string;
  newBrandName: string;
  newSlug: string;
  newOwnerEmail: string;
  newOwnerPhone?: string | null;
  newOwnerPassword?: string | null;
  includeDatabase: boolean;
  createdById: string;
  allowDuplicateEmail?: boolean;
};

export type DuplicateResult = {
  newTenantId: string;
  newSlug: string;
  publicUrl: string;
  includeDatabase: boolean;
  steps: DuplicateStep[];
  ownerTempPassword?: string;
};

const SLUG_REGEX = /^[a-z0-9-]+$/;
const TRIAL_DAYS = 5;

/**
 * Duplicador de negocios (item 12). Crea un Tenant nuevo copiando la
 * configuración del source en dos modalidades:
 *   - includeDatabase=false: solo configuración (menú, tarjetas, branding,
 *     QR, InfoLinks, MenuBook, Storefront, Reseñas multi-sede).
 *   - includeDatabase=true: ademas Customers, Passes, Stamps, Orders,
 *     ReviewFeedbacks, badges ganados, CRM (si el owner se replica).
 *
 * Nunca aborta — captura cada error individual y devuelve `steps[]` para
 * que el SUPER_ADMIN decida si rehacer o conservar lo parcialmente copiado.
 */
@Injectable()
export class TenantDuplicatorService {
  private logger = new Logger(TenantDuplicatorService.name);

  constructor(
    private prisma: PrismaService,
    private auth: AuthService,
    private audit: AuditService,
  ) {}

  async duplicate(opts: DuplicateOpts): Promise<DuplicateResult> {
    const brandName = (opts.newBrandName ?? '').trim();
    if (brandName.length < 2 || brandName.length > 80) {
      throw new BadRequestException(
        'El nombre del negocio debe tener entre 2 y 80 caracteres.',
      );
    }

    const slug = (opts.newSlug ?? '').trim().toLowerCase();
    if (slug.length < 3 || !SLUG_REGEX.test(slug)) {
      throw new BadRequestException(
        'El slug debe tener al menos 3 caracteres y solo contener letras minúsculas, números y guiones.',
      );
    }

    const email = (opts.newOwnerEmail ?? '').trim().toLowerCase();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new BadRequestException('El correo del dueño no es válido.');
    }

    const slugExists = await this.prisma.tenant.findUnique({
      where: { slug },
      select: { id: true },
    });
    if (slugExists) {
      throw new ConflictException(
        `Ya existe un negocio con el slug "${slug}". Elige otro.`,
      );
    }

    if (!opts.allowDuplicateEmail) {
      const emailExists = await this.prisma.user.findUnique({
        where: { email },
        select: { id: true },
      });
      if (emailExists) {
        throw new ConflictException(
          `El correo "${email}" ya está en uso. Confirma para forzar el duplicado.`,
        );
      }
    }

    const source = await this.prisma.tenant.findUnique({
      where: { id: opts.sourceTenantId },
    });
    if (!source) {
      throw new NotFoundException('Negocio origen no encontrado.');
    }

    const steps: DuplicateStep[] = [];
    const push = (
      name: string,
      status: DuplicateStepStatus,
      extra?: { message?: string; count?: number },
    ) => {
      steps.push({ name, status, ...(extra ?? {}) });
    };

    const tempPassword = opts.newOwnerPassword?.trim() || nanoid(12);
    const passwordHash = await this.auth.hashPassword(tempPassword);

    const now = new Date();
    const trialEndsAt = new Date(
      now.getTime() + TRIAL_DAYS * 24 * 60 * 60 * 1000,
    );

    // Tenant + dueño se crean atómicos. Si User.create falla (email
    // duplicado con allowDuplicateEmail=true, FK constraint, etc.),
    // el Tenant rollback al rollback de la TX y NO queda huérfano.
    let newTenantId: string;
    try {
      newTenantId = await this.prisma.$transaction(async (tx) => {
        const newTenant = await tx.tenant.create({
          data: {
            name: brandName,
            brandName,
            slug,
            email,
            // Hereda colores/branding/categorias/timezone/currency del source.
            phone: source.phone ?? null,
            whatsappPhone: opts.newOwnerPhone ?? null,
            googleReviewUrl: source.googleReviewUrl ?? null,
            whatsappFeedbackEnabled: source.whatsappFeedbackEnabled,
            whatsappFeedbackNumber: source.whatsappFeedbackNumber ?? null,
            whatsappFeedbackMessage: source.whatsappFeedbackMessage ?? null,
            whatsappOrdersPhone: source.whatsappOrdersPhone ?? null,
            whatsappDeliveryPhone: source.whatsappDeliveryPhone ?? null,
            logoUrl: source.logoUrl ?? null,
            walletLogoUrl: source.walletLogoUrl ?? null,
            pushLogoUrl: source.pushLogoUrl ?? null,
            primaryColor: source.primaryColor,
            secondaryColor: source.secondaryColor,
            businessCategorySlug: source.businessCategorySlug ?? null,
            planId: source.planId,
            planPeriodicity: source.planPeriodicity ?? null,
            maxStampsPerDay: source.maxStampsPerDay ?? null,
            maxLocationsOverride: source.maxLocationsOverride ?? null,
            currency: source.currency,
            timezone: source.timezone,
            instagramUrl: source.instagramUrl ?? null,
            facebookUrl: source.facebookUrl ?? null,
            mapsUrl: source.mapsUrl ?? null,
            mainSectionLabelOverride: source.mainSectionLabelOverride ?? null,
            // Trial fresco — no compartimos billing del source.
            status: 'TRIAL',
            trialStartedAt: now,
            trialEndsAt,
            gracePeriodDays: source.gracePeriodDays,
            currentPeriodEnd: null,
            hotmartSubscriberCode: `dup-${nanoid(10)}`,
            hotmartTransactionId: null,
            failedPaymentCount: 0,
            // Onboarding marcado como visto para que el nuevo dueño entre directo.
            welcomePopupSeenAt: now,
          },
          select: { id: true },
        });
        await tx.user.create({
          data: {
            tenantId: newTenant.id,
            email,
            passwordHash,
            fullName: brandName,
            phone: opts.newOwnerPhone ?? null,
            role: 'TENANT_OWNER',
            isActive: true,
          },
        });
        return newTenant.id;
      });
      push('Crear negocio nuevo', 'ok');
      push('Crear dueño del negocio', 'ok');
    } catch (err: any) {
      // Sin tenant ni dueño no podemos continuar — el resto depende del id.
      throw new BadRequestException(
        `No se pudo crear el negocio: ${err?.message ?? 'error desconocido'}`,
      );
    }

    // Locations — necesario antes de Card/ReviewQrTarget porque referencian.
    const locationMap = new Map<string, string>();
    await this.safeStep(steps, 'Copiar sedes', async () => {
      const locs = await this.prisma.location.findMany({
        where: { tenantId: opts.sourceTenantId },
      });
      for (const l of locs) {
        const newId = randomUUID();
        locationMap.set(l.id, newId);
        await this.prisma.location.create({
          data: {
            id: newId,
            tenantId: newTenantId,
            name: l.name,
            address: l.address,
            latitude: l.latitude,
            longitude: l.longitude,
            radiusMeters: l.radiusMeters,
            walletRelevantText: l.walletRelevantText ?? null,
            isActive: l.isActive,
          },
        });
      }
      return locs.length;
    });

    // Categories (con árbol parent/child). Primer pase los crea sin parent,
    // segundo pase setea parentId del mapping para no romper FK.
    const categoryMap = new Map<string, string>();
    await this.safeStep(steps, 'Copiar categorías', async () => {
      const cats = await this.prisma.category.findMany({
        where: { tenantId: opts.sourceTenantId },
      });
      for (const c of cats) {
        const newId = randomUUID();
        categoryMap.set(c.id, newId);
        await this.prisma.category.create({
          data: {
            id: newId,
            tenantId: newTenantId,
            name: c.name,
            slug: c.slug,
            description: c.description ?? null,
            imageUrl: c.imageUrl ?? null,
            tagline: c.tagline ?? null,
            coverConfig: c.coverConfig ?? undefined,
            popupConfig: c.popupConfig ?? undefined,
            position: c.position,
            isActive: c.isActive,
          },
        });
      }
      for (const c of cats) {
        if (!c.parentId) continue;
        const newId = categoryMap.get(c.id);
        const newParentId = categoryMap.get(c.parentId);
        if (newId && newParentId) {
          await this.prisma.category.update({
            where: { id: newId },
            data: { parentId: newParentId },
          });
        }
      }
      return cats.length;
    });

    // Adicionales (biblioteca de extras compartidos).
    await this.safeStep(steps, 'Copiar adicionales', async () => {
      const items = await this.prisma.adicional.findMany({
        where: { tenantId: opts.sourceTenantId },
      });
      for (const a of items) {
        await this.prisma.adicional.create({
          data: {
            tenantId: newTenantId,
            name: a.name,
            price: a.price,
            isActive: a.isActive,
            position: a.position,
          },
        });
      }
      return items.length;
    });

    // Products (con variants + extras).
    await this.safeStep(steps, 'Copiar productos', async () => {
      const products = await this.prisma.product.findMany({
        where: { tenantId: opts.sourceTenantId },
        include: { variants: true, extras: true },
      });
      let n = 0;
      for (const p of products) {
        const newCategoryId = categoryMap.get(p.categoryId);
        if (!newCategoryId) continue;
        await this.prisma.product.create({
          data: {
            tenantId: newTenantId,
            categoryId: newCategoryId,
            name: p.name,
            description: p.description,
            basePrice: p.basePrice,
            priceMode: p.priceMode,
            priceMax: p.priceMax ?? null,
            imageUrl: p.imageUrl ?? null,
            tags: p.tags,
            isAvailable: p.isAvailable,
            availableForMesa: p.availableForMesa,
            availableForDelivery: p.availableForDelivery,
            isRecommended: p.isRecommended,
            position: p.position,
            stock: p.stock ?? null,
            stockAlert: p.stockAlert ?? null,
            variants: {
              create: p.variants.map((v) => ({
                groupName: v.groupName,
                name: v.name,
                priceDelta: v.priceDelta,
                isDefault: v.isDefault,
                position: v.position,
              })),
            },
            extras: {
              create: p.extras.map((e) => ({
                name: e.name,
                price: e.price,
                maxQty: e.maxQty,
                isAvailable: e.isAvailable,
              })),
            },
          },
        });
        n += 1;
      }
      return n;
    });

    // Cards (plantillas de fidelización). Primer pase sin transformIntoCardId
    // ni location; segundo pase remapea ambos.
    const cardMap = new Map<string, string>();
    await this.safeStep(steps, 'Copiar tarjetas de fidelización', async () => {
      const cards = await this.prisma.card.findMany({
        where: { tenantId: opts.sourceTenantId },
      });
      for (const c of cards) {
        const newId = randomUUID();
        cardMap.set(c.id, newId);
        await this.prisma.card.create({
          data: {
            id: newId,
            tenantId: newTenantId,
            type: c.type,
            name: c.name,
            description: c.description,
            terms: c.terms,
            termsEnabled: c.termsEnabled,
            primaryColor: c.primaryColor,
            secondaryColor: c.secondaryColor,
            stampActiveColor: c.stampActiveColor ?? null,
            stampInactiveColor: c.stampInactiveColor ?? null,
            stampContourColor: c.stampContourColor ?? null,
            centerBgColor: c.centerBgColor ?? null,
            logoUrl: c.logoUrl ?? null,
            heroImageUrl: c.heroImageUrl ?? null,
            iconUrl: c.iconUrl ?? null,
            stampsRequired: c.stampsRequired ?? null,
            rewardText: c.rewardText,
            pointsPerCurrency: c.pointsPerCurrency ?? null,
            discountPercent: c.discountPercent ?? null,
            cashbackPercent: c.cashbackPercent ?? null,
            cashbackMinPurchase: c.cashbackMinPurchase ?? null,
            minAmountPerStamp: c.minAmountPerStamp ?? null,
            visitsRequired: c.visitsRequired ?? null,
            tiers: c.tiers ?? undefined,
            tierMetric: c.tierMetric,
            validFrom: c.validFrom ?? null,
            validUntil: c.validUntil ?? null,
            validDaysAfterIssue: c.validDaysAfterIssue ?? null,
            howToEarnText: c.howToEarnText,
            businessName: c.businessName,
            rewardDescText: c.rewardDescText,
            stampEarnedMessage: c.stampEarnedMessage,
            rewardEarnedMessage: c.rewardEarnedMessage,
            multiRewards: c.multiRewards ?? undefined,
            activeLinks: c.activeLinks ?? undefined,
            socialLinks: c.socialLinks ?? undefined,
            autoStampOnOrder: c.autoStampOnOrder,
            autoStampAmount: c.autoStampAmount,
            stampIcon: c.stampIcon,
            // Activación manual deliberada — el dueño revisa antes de habilitar.
            isActive: false,
          },
        });
      }
      // Segundo pase: remapea FK internas (transformIntoCardId + locationId).
      for (const c of cards) {
        const newId = cardMap.get(c.id);
        if (!newId) continue;
        const data: any = {};
        if (c.transformIntoCardId) {
          const t = cardMap.get(c.transformIntoCardId);
          if (t) data.transformIntoCardId = t;
        }
        if (c.locationId) {
          const l = locationMap.get(c.locationId);
          if (l) data.locationId = l;
        }
        if (Object.keys(data).length > 0) {
          await this.prisma.card.update({ where: { id: newId }, data });
        }
      }
      return cards.length;
    });

    // QrPoster — el JSON config se copia tal cual (incluye fix QR unmount clobber).
    await this.safeStep(steps, 'Copiar carteles QR', async () => {
      const posters = await this.prisma.qrPoster.findMany({
        where: { tenantId: opts.sourceTenantId },
      });
      for (const p of posters) {
        await this.prisma.qrPoster.create({
          data: {
            tenantId: newTenantId,
            type: p.type,
            name: p.name,
            config: p.config ?? undefined,
            lastExportUrl: null,
            isActive: p.isActive,
            targetUrl: p.targetUrl ?? null,
          },
        });
      }
      return posters.length;
    });

    // InfoLinks — rootSlug se anula porque es unique global.
    await this.safeStep(steps, 'Copiar info links', async () => {
      const links = await this.prisma.infoLink.findMany({
        where: { tenantId: opts.sourceTenantId },
      });
      for (const l of links) {
        await this.prisma.infoLink.create({
          data: {
            tenantId: newTenantId,
            slug: l.slug,
            rootSlug: null,
            title: l.title,
            subtitle: l.subtitle ?? null,
            heroImageUrl: l.heroImageUrl ?? null,
            gallery: l.gallery ?? undefined,
            sections: l.sections ?? undefined,
            buttons: l.buttons ?? undefined,
            theme: l.theme ?? undefined,
            isActive: l.isActive,
            views: 0,
          },
        });
      }
      return links.length;
    });

    // MenuBook (libro flipbook) + páginas.
    await this.safeStep(steps, 'Copiar menú libro', async () => {
      const sections = await this.prisma.menuBookSection.findMany({
        where: { tenantId: opts.sourceTenantId },
        include: { pages: true },
      });
      for (const s of sections) {
        const popupCardRemap = s.popupCardId
          ? cardMap.get(s.popupCardId) ?? null
          : null;
        await this.prisma.menuBookSection.create({
          data: {
            tenantId: newTenantId,
            title: s.title,
            sortOrder: s.sortOrder,
            isActive: s.isActive,
            popupEnabled: s.popupEnabled,
            popupTitle: s.popupTitle ?? null,
            popupDescription: s.popupDescription ?? null,
            popupImageUrl: s.popupImageUrl ?? null,
            popupButtonText: s.popupButtonText ?? null,
            popupButtonUrl: s.popupButtonUrl ?? null,
            popupButtonColor: s.popupButtonColor ?? null,
            popupType: s.popupType ?? null,
            popupCardId: popupCardRemap,
            popupCardCtaLabel: s.popupCardCtaLabel ?? null,
            popupImageCaption: s.popupImageCaption ?? null,
            pages: {
              create: s.pages.map((p) => {
                const pageCardRemap = p.popupCardId
                  ? cardMap.get(p.popupCardId) ?? null
                  : null;
                return {
                  imageUrl: p.imageUrl,
                  sortOrder: p.sortOrder,
                  isActive: p.isActive,
                  popupEnabled: p.popupEnabled,
                  popupTitle: p.popupTitle ?? null,
                  popupDescription: p.popupDescription ?? null,
                  popupImageUrl: p.popupImageUrl ?? null,
                  popupButtonText: p.popupButtonText ?? null,
                  popupButtonUrl: p.popupButtonUrl ?? null,
                  popupButtonColor: p.popupButtonColor ?? null,
                  popupType: p.popupType ?? null,
                  popupCardId: pageCardRemap,
                  popupCardCtaLabel: p.popupCardCtaLabel ?? null,
                  popupImageCaption: p.popupImageCaption ?? null,
                };
              }),
            },
          },
        });
      }
      return sections.length;
    });

    // Storefront — un solo registro por tenant; copia toda la config visual.
    await this.safeStep(steps, 'Copiar storefront', async () => {
      const sf = await this.prisma.storefront.findUnique({
        where: { tenantId: opts.sourceTenantId },
      });
      if (!sf) return 0;
      const popupCardRemap = sf.popupCardId
        ? cardMap.get(sf.popupCardId) ?? null
        : null;
      const bookPopupCardRemap = sf.bookPopupCardId
        ? cardMap.get(sf.bookPopupCardId) ?? null
        : null;
      await this.prisma.storefront.create({
        data: {
          tenantId: newTenantId,
          // customDomain es unique global — nunca se duplica.
          customDomain: null,
          theme: sf.theme ?? undefined,
          blocks: sf.blocks ?? undefined,
          description: sf.description,
          heroImageUrl: sf.heroImageUrl ?? null,
          menuLayout: sf.menuLayout,
          ordersEnabled: sf.ordersEnabled,
          ordersDeliveryEnabled: sf.ordersDeliveryEnabled,
          popupEnabled: sf.popupEnabled,
          popupImageUrl: sf.popupImageUrl ?? null,
          popupCardId: popupCardRemap,
          popupDelaySeconds: sf.popupDelaySeconds,
          bookPopupEnabled: sf.bookPopupEnabled,
          bookPopupTitle: sf.bookPopupTitle ?? null,
          bookPopupDescription: sf.bookPopupDescription ?? null,
          bookPopupImageUrl: sf.bookPopupImageUrl ?? null,
          bookPopupButtonText: sf.bookPopupButtonText ?? null,
          bookPopupButtonUrl: sf.bookPopupButtonUrl ?? null,
          bookPopupButtonColor: sf.bookPopupButtonColor ?? null,
          bookPopupDelaySeconds: sf.bookPopupDelaySeconds,
          bookPopupType: sf.bookPopupType ?? null,
          bookPopupCardId: bookPopupCardRemap,
          bookPopupCardCtaLabel: sf.bookPopupCardCtaLabel ?? null,
          bookPopupImageCaption: sf.bookPopupImageCaption ?? null,
          whatsappButtonEnabled: sf.whatsappButtonEnabled,
          pageBackgroundColor: sf.pageBackgroundColor ?? null,
          pageBackgroundType: sf.pageBackgroundType ?? null,
          pageBackgroundGradient: sf.pageBackgroundGradient ?? null,
          pageBackgroundImageUrl: sf.pageBackgroundImageUrl ?? null,
          logoBgColor: sf.logoBgColor ?? null,
          titleColor: sf.titleColor ?? null,
          descriptionColor: sf.descriptionColor ?? null,
          backButtonConfig: sf.backButtonConfig ?? undefined,
          recommendedTagline: sf.recommendedTagline ?? null,
          recommendedCoverConfig: sf.recommendedCoverConfig ?? undefined,
          digitalMenuEnabled: sf.digitalMenuEnabled,
          bookMenuEnabled: sf.bookMenuEnabled,
          isPublished: sf.isPublished,
        },
      });
      return 1;
    });

    // Promotions (config — sin redemptions).
    await this.safeStep(steps, 'Copiar promociones', async () => {
      const promos = await this.prisma.promotion.findMany({
        where: { tenantId: opts.sourceTenantId },
      });
      for (const p of promos) {
        await this.prisma.promotion.create({
          data: {
            tenantId: newTenantId,
            name: p.name,
            description: p.description,
            imageUrl: p.imageUrl ?? null,
            type: p.type,
            value: p.value,
            originalPrice: p.originalPrice ?? null,
            conditions: p.conditions ?? undefined,
            validFrom: p.validFrom ?? null,
            validUntil: p.validUntil ?? null,
            maxRedemptions: p.maxRedemptions ?? null,
            maxRedemptionsPerCustomer: p.maxRedemptionsPerCustomer ?? null,
            isActive: p.isActive,
          },
        });
      }
      return promos.length;
    });

    // ReviewQrTarget — multi-sede de reseñas.
    await this.safeStep(steps, 'Copiar destinos de reseñas', async () => {
      const targets = await this.prisma.reviewQrTarget.findMany({
        where: { tenantId: opts.sourceTenantId },
      });
      for (const t of targets) {
        await this.prisma.reviewQrTarget.create({
          data: {
            tenantId: newTenantId,
            locationId: t.locationId ? locationMap.get(t.locationId) ?? null : null,
            name: t.name,
            address: t.address ?? null,
            googleReviewUrl: t.googleReviewUrl,
            threshold: t.threshold,
            isActive: t.isActive,
            position: t.position,
          },
        });
      }
      return targets.length;
    });

    // Plantillas de mensajes, channel config y badges (config sin data).
    await this.safeStep(steps, 'Copiar plantillas de mensajes', async () => {
      const tpls = await this.prisma.messageTemplate.findMany({
        where: { tenantId: opts.sourceTenantId },
      });
      for (const t of tpls) {
        await this.prisma.messageTemplate.create({
          data: {
            tenantId: newTenantId,
            name: t.name,
            channel: t.channel,
            body: t.body,
            variables: t.variables,
            metaTemplateId: t.metaTemplateId ?? null,
            isActive: t.isActive,
          },
        });
      }
      return tpls.length;
    });

    await this.safeStep(steps, 'Copiar canales', async () => {
      const ch = await this.prisma.channelConfig.findMany({
        where: { tenantId: opts.sourceTenantId },
      });
      for (const c of ch) {
        await this.prisma.channelConfig.create({
          data: {
            tenantId: newTenantId,
            type: c.type,
            config: (c.config ?? {}) as any,
            isActive: c.isActive,
            isDefault: c.isDefault,
          },
        });
      }
      return ch.length;
    });

    const badgeMap = new Map<string, string>();
    await this.safeStep(steps, 'Copiar insignias', async () => {
      const badges = await this.prisma.badge.findMany({
        where: { tenantId: opts.sourceTenantId },
      });
      for (const b of badges) {
        const newId = randomUUID();
        badgeMap.set(b.id, newId);
        await this.prisma.badge.create({
          data: {
            id: newId,
            tenantId: newTenantId,
            name: b.name,
            description: b.description,
            icon: b.icon,
            color: b.color,
            criteria: b.criteria ?? undefined,
            xpReward: b.xpReward,
            isActive: b.isActive,
          },
        });
      }
      return badges.length;
    });

    // Reglas de automatización (sin runs históricos).
    await this.safeStep(steps, 'Copiar automatizaciones', async () => {
      const rules = await this.prisma.automationRule.findMany({
        where: { tenantId: opts.sourceTenantId },
      });
      for (const r of rules) {
        await this.prisma.automationRule.create({
          data: {
            tenantId: newTenantId,
            name: r.name,
            description: r.description,
            trigger: (r.trigger ?? {}) as any,
            conditions: (r.conditions ?? []) as any,
            actions: (r.actions ?? []) as any,
            stats: {},
            isActive: r.isActive,
          },
        });
      }
      return rules.length;
    });

    // ─────────── Steps EXTRA si includeDatabase=true ───────────
    const customerMap = new Map<string, string>();
    const passMap = new Map<string, string>();
    const orderMap = new Map<string, string>();

    if (opts.includeDatabase) {
      await this.safeStep(steps, 'Copiar clientes', async () => {
        const customers = await this.prisma.customer.findMany({
          where: { tenantId: opts.sourceTenantId },
        });
        for (const c of customers) {
          const newId = randomUUID();
          customerMap.set(c.id, newId);
          await this.prisma.customer.create({
            data: {
              id: newId,
              tenantId: newTenantId,
              email: c.email ?? null,
              phone: c.phone ?? null,
              fullName: c.fullName,
              birthday: c.birthday ?? null,
              externalId: c.externalId ?? null,
              firstOrderAt: c.firstOrderAt ?? null,
              lastOrderAt: c.lastOrderAt ?? null,
              totalOrdersCount: c.totalOrdersCount,
              totalOrdersAmount: c.totalOrdersAmount,
              tags: c.tags,
              notes: c.notes ?? null,
              marketingOptIn: c.marketingOptIn,
              whatsappVerified: c.whatsappVerified,
              xpPoints: c.xpPoints,
              currentLevel: c.currentLevel,
              currentStreakDays: c.currentStreakDays,
              longestStreakDays: c.longestStreakDays,
              lastVisitDay: c.lastVisitDay ?? null,
            },
          });
        }
        return customers.length;
      });

      await this.safeStep(steps, 'Copiar tarjetas instaladas (passes)', async () => {
        const passes = await this.prisma.pass.findMany({
          where: { tenantId: opts.sourceTenantId },
        });
        for (const p of passes) {
          const newCardId = cardMap.get(p.cardId);
          const newCustomerId = customerMap.get(p.customerId);
          if (!newCardId || !newCustomerId) continue;
          const newId = randomUUID();
          passMap.set(p.id, newId);
          await this.prisma.pass.create({
            data: {
              id: newId,
              tenantId: newTenantId,
              cardId: newCardId,
              customerId: newCustomerId,
              // serialNumber + qrToken son unique globales — regeneramos.
              serialNumber: `${newTenantId.slice(0, 8)}-${nanoid(12)}`,
              qrToken: nanoid(24),
              authToken: nanoid(32),
              stampsCount: p.stampsCount,
              pointsBalance: p.pointsBalance,
              cashbackBalance: p.cashbackBalance,
              visitsCount: p.visitsCount,
              currentTier: p.currentTier ?? null,
              tierProgress: p.tierProgress,
              status: p.status,
              issuedAt: p.issuedAt,
              lastActivityAt: p.lastActivityAt ?? null,
              walletPlatform: p.walletPlatform ?? null,
              walletInstalledAt: p.walletInstalledAt ?? null,
            },
          });
        }
        return passes.length;
      });

      await this.safeStep(steps, 'Copiar pedidos', async () => {
        const orders = await this.prisma.order.findMany({
          where: { tenantId: opts.sourceTenantId },
        });
        for (const o of orders) {
          const newCustomerId = customerMap.get(o.customerId);
          if (!newCustomerId) continue;
          const newId = randomUUID();
          orderMap.set(o.id, newId);
          await this.prisma.order.create({
            data: {
              id: newId,
              tenantId: newTenantId,
              customerId: newCustomerId,
              // Order.code es unique global — regeneramos para no chocar.
              code: `D${nanoid(10).toUpperCase()}`,
              items: (o.items ?? []) as any,
              subtotal: o.subtotal,
              discount: o.discount,
              deliveryAmount: o.deliveryAmount ?? null,
              total: o.total,
              status: o.status,
              channel: o.channel,
              fulfillment: o.fulfillment,
              mode: o.mode ?? null,
              tableNumber: o.tableNumber ?? null,
              deliveryAddress: (o.deliveryAddress as any) ?? undefined,
              customerNote: o.customerNote ?? null,
              locationId: o.locationId ? locationMap.get(o.locationId) ?? null : null,
              appliedPromos: o.appliedPromos ?? undefined,
              whatsappLink: o.whatsappLink ?? null,
              paymentStatus: o.paymentStatus,
              paymentMethod: o.paymentMethod,
              paymentProvider: o.paymentProvider ?? null,
              paymentRef: o.paymentRef ?? null,
              paymentUrl: o.paymentUrl ?? null,
              paidAt: o.paidAt ?? null,
              confirmedAt: o.confirmedAt ?? null,
              readyAt: o.readyAt ?? null,
              deliveredAt: o.deliveredAt ?? null,
              cancelledAt: o.cancelledAt ?? null,
              rating: o.rating ?? null,
              ratingComment: o.ratingComment ?? null,
              ratedAt: o.ratedAt ?? null,
            },
          });
        }
        return orders.length;
      });

      await this.safeStep(steps, 'Copiar historial de sellos', async () => {
        const stamps = await this.prisma.stamp.findMany({
          where: { tenantId: opts.sourceTenantId },
        });
        let n = 0;
        for (const s of stamps) {
          const newPassId = passMap.get(s.passId);
          const newCustomerId = customerMap.get(s.customerId);
          if (!newPassId || !newCustomerId) continue;
          await this.prisma.stamp.create({
            data: {
              tenantId: newTenantId,
              passId: newPassId,
              customerId: newCustomerId,
              locationId: s.locationId ? locationMap.get(s.locationId) ?? null : null,
              // operatorId apunta a User del source — no lo replicamos.
              operatorId: null,
              orderId: s.orderId ? orderMap.get(s.orderId) ?? null : null,
              action: s.action,
              amount: s.amount,
              purchaseAmount: s.purchaseAmount ?? null,
              note: s.note ?? null,
              createdAt: s.createdAt,
            },
          });
          n += 1;
        }
        return n;
      });

      await this.safeStep(steps, 'Copiar reseñas recibidas', async () => {
        const fbs = await this.prisma.reviewFeedback.findMany({
          where: { tenantId: opts.sourceTenantId },
        });
        for (const f of fbs) {
          await this.prisma.reviewFeedback.create({
            data: {
              tenantId: newTenantId,
              rating: f.rating,
              comment: f.comment ?? null,
              customerName: f.customerName ?? null,
              customerPhone: f.customerPhone ?? null,
              redirectedToGoogle: f.redirectedToGoogle,
              isRead: f.isRead,
              createdAt: f.createdAt,
            },
          });
        }
        return fbs.length;
      });

      await this.safeStep(steps, 'Copiar badges ganados', async () => {
        const earned = await this.prisma.customerBadge.findMany({
          where: { customer: { tenantId: opts.sourceTenantId } },
        });
        let n = 0;
        for (const e of earned) {
          const newCustomerId = customerMap.get(e.customerId);
          const newBadgeId = badgeMap.get(e.badgeId);
          if (!newCustomerId || !newBadgeId) continue;
          await this.prisma.customerBadge.create({
            data: {
              customerId: newCustomerId,
              badgeId: newBadgeId,
              earnedAt: e.earnedAt,
            },
          });
          n += 1;
        }
        return n;
      });
    }

    const apiBase =
      process.env.APP_PUBLIC_URL?.replace(/\/$/, '') ??
      process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '') ??
      'https://soyclubify.com';
    const publicUrl = `${apiBase}/m/${slug}`;

    this.audit.log({
      actorId: opts.createdById,
      tenantId: newTenantId,
      action: 'TENANT_DUPLICATED',
      resource: `tenant:${newTenantId}`,
      metadata: {
        sourceTenantId: opts.sourceTenantId,
        newTenantId,
        includeDatabase: opts.includeDatabase,
        timestamp: new Date().toISOString(),
      },
    });

    return {
      newTenantId,
      newSlug: slug,
      publicUrl,
      includeDatabase: opts.includeDatabase,
      steps,
      ownerTempPassword: opts.newOwnerPassword ? undefined : tempPassword,
    };
  }

  /**
   * Envuelve un step en try/catch: si falla agrega `error` al reporte y
   * continúa con el siguiente — el SUPER_ADMIN ve qué falló y decide.
   */
  private async safeStep(
    steps: DuplicateStep[],
    name: string,
    fn: () => Promise<number>,
  ) {
    try {
      const count = await fn();
      steps.push({ name, status: 'ok', count });
    } catch (err: any) {
      this.logger.warn(
        `Duplicator step "${name}" falló: ${err?.message ?? 'unknown'}`,
      );
      steps.push({
        name,
        status: 'error',
        message: err?.message ?? 'Error desconocido',
      });
    }
  }
}
