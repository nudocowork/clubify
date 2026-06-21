import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { MenuLayout } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { AuthUser } from '../common/decorators/current-user.decorator';
import { hasAdminBypass } from '../common/roles/admin-bypass';
import { safeUrlOrNull } from '../common/util/safe-url';

export type StorefrontDto = {
  description?: string;
  heroImageUrl?: string;
  theme?: any;
  blocks?: any[];
  isPublished?: boolean;
  ordersEnabled?: boolean;
  ordersDeliveryEnabled?: boolean;
  // M3: popup global del Menú Libro.
  bookPopupEnabled?: boolean;
  bookPopupTitle?: string | null;
  bookPopupDescription?: string | null;
  bookPopupImageUrl?: string | null;
  bookPopupButtonText?: string | null;
  bookPopupButtonUrl?: string | null;
  bookPopupButtonColor?: string | null;
  bookPopupDelaySeconds?: number;
  // M9: discriminator + payload alternativo del popup global.
  bookPopupType?: string | null;
  bookPopupCardId?: string | null;
  bookPopupCardCtaLabel?: string | null;
  bookPopupImageCaption?: string | null;
  popupEnabled?: boolean;
  popupImageUrl?: string | null;
  popupCardId?: string | null;
  popupDelaySeconds?: number;
  whatsappButtonEnabled?: boolean;
  pageBackgroundColor?: string | null;
  pageBackgroundType?: string | null;
  pageBackgroundGradient?: string | null;
  pageBackgroundImageUrl?: string | null;
  logoBgColor?: string | null;
  titleColor?: string | null;
  descriptionColor?: string | null;
  backButtonConfig?: Record<string, any> | null;
  recommendedTagline?: string | null;
  recommendedCoverConfig?: Record<string, any> | null;
  menuLayout?: MenuLayout;
  digitalMenuEnabled?: boolean;
  bookMenuEnabled?: boolean;
  bookMenuDirection?: string;
  customDomain?: string | null;
};

@Injectable()
export class StorefrontService {
  constructor(private prisma: PrismaService) {}

  private tid(user: AuthUser, override?: string) {
    if (hasAdminBypass(user.role)) {
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
    // M9: validar shape efectivo del bookPopup (post-patch) ANTES del upsert
    // para no dejar payloads incoherentes en DB. Solo si el dto toca alguno
    // de los campos relevantes — sino dejamos pasar (PATCH parcial común).
    const touchesBookPopup =
      dto.bookPopupEnabled !== undefined ||
      dto.bookPopupType !== undefined ||
      dto.bookPopupCardId !== undefined ||
      dto.bookPopupButtonUrl !== undefined ||
      dto.bookPopupImageUrl !== undefined;
    if (touchesBookPopup) {
      const existing = await this.prisma.storefront.findUnique({
        where: { tenantId: tid },
        select: {
          bookPopupEnabled: true,
          bookPopupType: true,
          bookPopupCardId: true,
          bookPopupButtonUrl: true,
          bookPopupImageUrl: true,
        },
      });
      const nextEnabled = dto.bookPopupEnabled ?? existing?.bookPopupEnabled ?? false;
      const nextType =
        dto.bookPopupType === undefined ? existing?.bookPopupType ?? null : dto.bookPopupType;
      const nextCardId =
        dto.bookPopupCardId === undefined
          ? existing?.bookPopupCardId ?? null
          : dto.bookPopupCardId;
      const nextButtonUrl =
        dto.bookPopupButtonUrl === undefined
          ? existing?.bookPopupButtonUrl ?? null
          : dto.bookPopupButtonUrl;
      const nextImageUrl =
        dto.bookPopupImageUrl === undefined
          ? existing?.bookPopupImageUrl ?? null
          : dto.bookPopupImageUrl;
      await this.validateBookPopup(
        tid,
        nextEnabled,
        nextType,
        nextCardId,
        nextButtonUrl,
        nextImageUrl,
      );
    }
    return this.prisma.storefront.upsert({
      where: { tenantId: tid },
      create: {
        tenantId: tid,
        description: dto.description ?? '',
        heroImageUrl: dto.heroImageUrl,
        theme: dto.theme ?? {},
        blocks: dto.blocks ?? [],
        isPublished: dto.isPublished ?? true,
        ordersEnabled: dto.ordersEnabled ?? true,
        ordersDeliveryEnabled: dto.ordersDeliveryEnabled ?? true,
        customDomain,
      },
      update: {
        description: dto.description ?? undefined,
        heroImageUrl: dto.heroImageUrl ?? undefined,
        theme: dto.theme ?? undefined,
        blocks: dto.blocks ?? undefined,
        isPublished: dto.isPublished ?? undefined,
        ordersEnabled: dto.ordersEnabled ?? undefined,
        ordersDeliveryEnabled: dto.ordersDeliveryEnabled ?? undefined,
        popupEnabled: dto.popupEnabled ?? undefined,
        popupImageUrl: dto.popupImageUrl !== undefined ? dto.popupImageUrl : undefined,
        popupCardId: dto.popupCardId !== undefined ? dto.popupCardId : undefined,
        popupDelaySeconds: dto.popupDelaySeconds ?? undefined,
        // M3: popup global del Menú Libro.
        bookPopupEnabled: dto.bookPopupEnabled ?? undefined,
        bookPopupTitle:
          dto.bookPopupTitle === undefined ? undefined : dto.bookPopupTitle,
        bookPopupDescription:
          dto.bookPopupDescription === undefined
            ? undefined
            : dto.bookPopupDescription,
        bookPopupImageUrl:
          dto.bookPopupImageUrl === undefined
            ? undefined
            : dto.bookPopupImageUrl
            ? safeUrlOrNull(dto.bookPopupImageUrl) ?? null
            : null,
        bookPopupButtonText:
          dto.bookPopupButtonText === undefined
            ? undefined
            : dto.bookPopupButtonText,
        bookPopupButtonUrl:
          dto.bookPopupButtonUrl === undefined
            ? undefined
            : safeUrlOrNull(dto.bookPopupButtonUrl) ?? null,
        bookPopupButtonColor:
          dto.bookPopupButtonColor === undefined
            ? undefined
            : dto.bookPopupButtonColor,
        bookPopupDelaySeconds: dto.bookPopupDelaySeconds ?? undefined,
        // M9: tipo de popup + payload CARD/IMAGE.
        bookPopupType:
          dto.bookPopupType === undefined ? undefined : dto.bookPopupType,
        bookPopupCardId:
          dto.bookPopupCardId === undefined ? undefined : dto.bookPopupCardId,
        bookPopupCardCtaLabel:
          dto.bookPopupCardCtaLabel === undefined
            ? undefined
            : dto.bookPopupCardCtaLabel,
        bookPopupImageCaption:
          dto.bookPopupImageCaption === undefined
            ? undefined
            : dto.bookPopupImageCaption,
        whatsappButtonEnabled: dto.whatsappButtonEnabled ?? undefined,
        pageBackgroundColor:
          dto.pageBackgroundColor === undefined
            ? undefined
            : dto.pageBackgroundColor,
        pageBackgroundType:
          dto.pageBackgroundType === undefined
            ? undefined
            : dto.pageBackgroundType,
        pageBackgroundGradient:
          dto.pageBackgroundGradient === undefined
            ? undefined
            : dto.pageBackgroundGradient,
        pageBackgroundImageUrl:
          dto.pageBackgroundImageUrl === undefined
            ? undefined
            : dto.pageBackgroundImageUrl,
        logoBgColor:
          dto.logoBgColor === undefined ? undefined : dto.logoBgColor,
        titleColor:
          dto.titleColor === undefined ? undefined : dto.titleColor,
        descriptionColor:
          dto.descriptionColor === undefined ? undefined : dto.descriptionColor,
        backButtonConfig:
          dto.backButtonConfig === undefined
            ? undefined
            : (dto.backButtonConfig as any),
        recommendedTagline:
          dto.recommendedTagline === undefined ? undefined : dto.recommendedTagline,
        recommendedCoverConfig:
          dto.recommendedCoverConfig === undefined
            ? undefined
            : (dto.recommendedCoverConfig as any),
        menuLayout: dto.menuLayout ?? undefined,
        digitalMenuEnabled: dto.digitalMenuEnabled ?? undefined,
        bookMenuEnabled: dto.bookMenuEnabled ?? undefined,
        bookMenuDirection: dto.bookMenuDirection ?? undefined,
        customDomain: dto.customDomain === undefined ? undefined : customDomain,
      },
    });
  }

  /** Resuelve un host (Host header) al slug del tenant correspondiente. */
  /** Sedes activas de un tenant (por slug) para el ruteo de pedidos por estado
   *  en el checkout público. Devuelve solo lo necesario para el selector. */
  async publicLocations(slug: string) {
    const s = (slug ?? '').trim().toLowerCase();
    if (!s) return [];
    const tenant = await this.prisma.tenant.findUnique({
      where: { slug: s },
      select: { id: true },
    });
    if (!tenant) return [];
    const locations = await this.prisma.location.findMany({
      where: { tenantId: tenant.id, isActive: true },
      select: { id: true, name: true, state: true, address: true },
      orderBy: { name: 'asc' },
    });
    return locations;
  }

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

  /**
   * M9: valida el shape del popup global del libro según `bookPopupType`.
   * Espejo del helper en MenuBookService.validatePopupPayload pero adaptado
   * a los nombres de columna `bookPopup*`.
   */
  private async validateBookPopup(
    tenantId: string,
    enabled: boolean,
    type: string | null | undefined,
    cardId: string | null | undefined,
    buttonUrl: string | null | undefined,
    imageUrl: string | null | undefined,
  ) {
    if (!enabled) return;
    const effective = (type ?? 'EXTERNAL_LINK') as
      | 'EXTERNAL_LINK'
      | 'CARD'
      | 'IMAGE';
    if (effective === 'EXTERNAL_LINK') {
      if (!buttonUrl?.trim()) {
        throw new BadRequestException(
          'bookPopup EXTERNAL_LINK requiere bookPopupButtonUrl',
        );
      }
      if (safeUrlOrNull(buttonUrl) == null) {
        throw new BadRequestException('bookPopupButtonUrl no es una URL segura');
      }
      return;
    }
    if (effective === 'CARD') {
      if (!cardId) {
        throw new BadRequestException('bookPopup CARD requiere bookPopupCardId');
      }
      const card = await this.prisma.card.findUnique({
        where: { id: cardId },
        select: { tenantId: true },
      });
      if (!card || card.tenantId !== tenantId) {
        throw new BadRequestException(
          'La tarjeta no existe o no pertenece a tu negocio',
        );
      }
      return;
    }
    if (effective === 'IMAGE') {
      if (!imageUrl?.trim()) {
        throw new BadRequestException('bookPopup IMAGE requiere bookPopupImageUrl');
      }
      if (safeUrlOrNull(imageUrl) == null) {
        throw new BadRequestException('bookPopupImageUrl no es una URL segura');
      }
      return;
    }
    throw new BadRequestException(`bookPopupType inválido: ${effective}`);
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
