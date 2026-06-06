import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { AuthUser } from '../common/decorators/current-user.decorator';
import { safeUrlOrNull } from '../common/util/safe-url';

// M9 (2026-06-06): tipos de popup mutuamente excluyentes.
// NULL/missing en DB = EXTERNAL_LINK (back compat con popups creados
// antes de M9).
export type PopupType = 'EXTERNAL_LINK' | 'CARD' | 'IMAGE';

export type SectionDto = {
  title: string;
  isActive?: boolean;
  popupEnabled?: boolean;
  popupTitle?: string | null;
  popupDescription?: string | null;
  popupImageUrl?: string | null;
  popupButtonText?: string | null;
  popupButtonUrl?: string | null;
  popupButtonColor?: string | null;
  popupType?: string | null;
  popupCardId?: string | null;
  popupCardCtaLabel?: string | null;
  popupImageCaption?: string | null;
};

export type PageDto = {
  imageUrl: string;
  isActive?: boolean;
  popupEnabled?: boolean;
  popupTitle?: string | null;
  popupDescription?: string | null;
  popupImageUrl?: string | null;
  popupButtonText?: string | null;
  popupButtonUrl?: string | null;
  popupButtonColor?: string | null;
  popupType?: string | null;
  popupCardId?: string | null;
  popupCardCtaLabel?: string | null;
  popupImageCaption?: string | null;
};

/**
 * Servicio del menú visual tipo libro (FLIPBOOK). Scopea todo por tenant
 * — el SUPER_ADMIN puede operar pasando `override` explícito; cualquier
 * otro rol queda anclado a su `tenantId`.
 *
 * Coexiste con el menú clásico Category/Product: el storefront decide
 * cuál renderizar según `Storefront.menuLayout`. Si el tenant pasa de
 * CLASSIC a FLIPBOOK, las secciones del libro se muestran; si vuelve a
 * CLASSIC, quedan persistidas pero ocultas (sin destrucción de datos).
 */
@Injectable()
export class MenuBookService {
  constructor(private prisma: PrismaService) {}

  private tid(user: AuthUser, override?: string) {
    if (user.role === 'SUPER_ADMIN') {
      if (!override) throw new ForbiddenException('tenantId required');
      return override;
    }
    if (!user.tenantId) throw new ForbiddenException();
    return user.tenantId;
  }

  /**
   * M9: valida el shape de un popup según `popupType`. Solo corre cuando
   * `popupEnabled=true`; con enabled=false el resto del payload se ignora
   * y no tiene sentido bloquear el guardado.
   *
   * - EXTERNAL_LINK (o NULL por back compat): `buttonUrl` requerido y debe
   *   pasar `safeUrlOrNull` (bloquea javascript:, data:, etc).
   * - CARD: `cardId` requerido y la Card debe pertenecer al MISMO tenant.
   * - IMAGE: `imageUrl` requerido y debe pasar `safeUrlOrNull`.
   *
   * Devuelve el payload normalizado para usar directo en `data: {...}` del
   * Prisma create/update.
   */
  private async validatePopupPayload(
    tenantId: string,
    enabled: boolean,
    type: string | null | undefined,
    cardId: string | null | undefined,
    buttonUrl: string | null | undefined,
    imageUrl: string | null | undefined,
  ) {
    if (!enabled) return; // nothing to validate cuando el popup está apagado.
    const effective = (type ?? 'EXTERNAL_LINK') as PopupType;
    if (effective === 'EXTERNAL_LINK') {
      if (!buttonUrl?.trim()) {
        throw new BadRequestException('Popup EXTERNAL_LINK requiere buttonUrl');
      }
      if (safeUrlOrNull(buttonUrl) == null) {
        throw new BadRequestException('buttonUrl no es una URL segura');
      }
      return;
    }
    if (effective === 'CARD') {
      if (!cardId) {
        throw new BadRequestException('Popup CARD requiere cardId');
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
        throw new BadRequestException('Popup IMAGE requiere imageUrl');
      }
      if (safeUrlOrNull(imageUrl) == null) {
        throw new BadRequestException('imageUrl no es una URL segura');
      }
      return;
    }
    throw new BadRequestException(`popupType inválido: ${effective}`);
  }

  /** Lista secciones del tenant con sus páginas, ordenadas. */
  list(user: AuthUser, override?: string) {
    const tid = this.tid(user, override);
    return this.prisma.menuBookSection.findMany({
      where: { tenantId: tid },
      include: {
        pages: { orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] },
      },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
  }

  async createSection(user: AuthUser, dto: SectionDto, override?: string) {
    const tid = this.tid(user, override);
    if (!dto.title?.trim()) {
      throw new BadRequestException('title requerido');
    }
    await this.validatePopupPayload(
      tid,
      dto.popupEnabled ?? false,
      dto.popupType,
      dto.popupCardId,
      dto.popupButtonUrl,
      dto.popupImageUrl,
    );
    const last = await this.prisma.menuBookSection.findFirst({
      where: { tenantId: tid },
      orderBy: { sortOrder: 'desc' },
    });
    return this.prisma.menuBookSection.create({
      data: {
        tenantId: tid,
        title: dto.title.trim(),
        isActive: dto.isActive ?? true,
        sortOrder: (last?.sortOrder ?? -1) + 1,
        popupEnabled: dto.popupEnabled ?? false,
        popupTitle: dto.popupTitle ?? null,
        popupDescription: dto.popupDescription ?? null,
        popupImageUrl: dto.popupImageUrl
          ? safeUrlOrNull(dto.popupImageUrl) ?? null
          : null,
        popupButtonText: dto.popupButtonText ?? null,
        popupButtonUrl: dto.popupButtonUrl
          ? safeUrlOrNull(dto.popupButtonUrl) ?? null
          : null,
        popupButtonColor: dto.popupButtonColor ?? null,
        popupType: dto.popupType ?? null,
        popupCardId: dto.popupCardId ?? null,
        popupCardCtaLabel: dto.popupCardCtaLabel ?? null,
        popupImageCaption: dto.popupImageCaption ?? null,
      },
    });
  }

  async updateSection(
    user: AuthUser,
    id: string,
    patch: Partial<SectionDto>,
    override?: string,
  ) {
    const tid = this.tid(user, override);
    const section = await this.prisma.menuBookSection.findUnique({
      where: { id },
    });
    if (!section || section.tenantId !== tid) {
      throw new NotFoundException('Sección no encontrada');
    }
    // Reconstruir el estado efectivo post-patch para validar shape coherente.
    const nextEnabled = patch.popupEnabled ?? section.popupEnabled;
    const nextType =
      patch.popupType === undefined ? section.popupType : patch.popupType;
    const nextCardId =
      patch.popupCardId === undefined ? section.popupCardId : patch.popupCardId;
    const nextButtonUrl =
      patch.popupButtonUrl === undefined
        ? section.popupButtonUrl
        : patch.popupButtonUrl;
    const nextImageUrl =
      patch.popupImageUrl === undefined
        ? section.popupImageUrl
        : patch.popupImageUrl;
    await this.validatePopupPayload(
      tid,
      nextEnabled,
      nextType,
      nextCardId,
      nextButtonUrl,
      nextImageUrl,
    );
    return this.prisma.menuBookSection.update({
      where: { id },
      data: {
        title: patch.title?.trim() ?? section.title,
        isActive: patch.isActive ?? section.isActive,
        popupEnabled: patch.popupEnabled ?? section.popupEnabled,
        popupTitle:
          patch.popupTitle === undefined ? section.popupTitle : patch.popupTitle,
        popupDescription:
          patch.popupDescription === undefined
            ? section.popupDescription
            : patch.popupDescription,
        popupImageUrl:
          patch.popupImageUrl === undefined
            ? section.popupImageUrl
            : patch.popupImageUrl
            ? safeUrlOrNull(patch.popupImageUrl) ?? null
            : null,
        popupButtonText:
          patch.popupButtonText === undefined
            ? section.popupButtonText
            : patch.popupButtonText,
        popupButtonUrl:
          patch.popupButtonUrl === undefined
            ? section.popupButtonUrl
            : patch.popupButtonUrl
            ? safeUrlOrNull(patch.popupButtonUrl) ?? null
            : null,
        popupButtonColor:
          patch.popupButtonColor === undefined
            ? section.popupButtonColor
            : patch.popupButtonColor,
        popupType:
          patch.popupType === undefined ? section.popupType : patch.popupType,
        popupCardId:
          patch.popupCardId === undefined ? section.popupCardId : patch.popupCardId,
        popupCardCtaLabel:
          patch.popupCardCtaLabel === undefined
            ? section.popupCardCtaLabel
            : patch.popupCardCtaLabel,
        popupImageCaption:
          patch.popupImageCaption === undefined
            ? section.popupImageCaption
            : patch.popupImageCaption,
      },
    });
  }

  async deleteSection(user: AuthUser, id: string, override?: string) {
    const tid = this.tid(user, override);
    const section = await this.prisma.menuBookSection.findUnique({
      where: { id },
    });
    if (!section || section.tenantId !== tid) {
      throw new NotFoundException('Sección no encontrada');
    }
    await this.prisma.menuBookSection.delete({ where: { id } });
    return { ok: true };
  }

  /** Reordena secciones según el array de ids dado. */
  async reorderSections(
    user: AuthUser,
    ids: string[],
    override?: string,
  ) {
    const tid = this.tid(user, override);
    if (!Array.isArray(ids) || ids.length === 0) {
      throw new BadRequestException('ids array requerido');
    }
    const sections = await this.prisma.menuBookSection.findMany({
      where: { tenantId: tid, id: { in: ids } },
      select: { id: true },
    });
    const validIds = new Set(sections.map((s) => s.id));
    await this.prisma.$transaction(
      ids
        .filter((id) => validIds.has(id))
        .map((id, idx) =>
          this.prisma.menuBookSection.update({
            where: { id },
            data: { sortOrder: idx },
          }),
        ),
    );
    return { ok: true, count: validIds.size };
  }

  // ─────────────────────────────────────────────────────────────────────
  // Páginas
  // ─────────────────────────────────────────────────────────────────────

  async createPage(
    user: AuthUser,
    sectionId: string,
    dto: PageDto,
    override?: string,
  ) {
    const tid = this.tid(user, override);
    const section = await this.prisma.menuBookSection.findUnique({
      where: { id: sectionId },
    });
    if (!section || section.tenantId !== tid) {
      throw new NotFoundException('Sección no encontrada');
    }
    if (!dto.imageUrl?.trim()) {
      throw new BadRequestException('imageUrl requerido');
    }
    await this.validatePopupPayload(
      tid,
      dto.popupEnabled ?? false,
      dto.popupType,
      dto.popupCardId,
      dto.popupButtonUrl,
      dto.popupImageUrl,
    );
    const last = await this.prisma.menuBookPage.findFirst({
      where: { sectionId },
      orderBy: { sortOrder: 'desc' },
    });
    return this.prisma.menuBookPage.create({
      data: {
        sectionId,
        imageUrl: dto.imageUrl.trim(),
        isActive: dto.isActive ?? true,
        sortOrder: (last?.sortOrder ?? -1) + 1,
        popupEnabled: dto.popupEnabled ?? false,
        popupTitle: dto.popupTitle ?? null,
        popupDescription: dto.popupDescription ?? null,
        popupImageUrl: dto.popupImageUrl
          ? safeUrlOrNull(dto.popupImageUrl) ?? null
          : null,
        popupButtonText: dto.popupButtonText ?? null,
        popupButtonUrl: dto.popupButtonUrl
          ? safeUrlOrNull(dto.popupButtonUrl) ?? null
          : null,
        popupButtonColor: dto.popupButtonColor ?? null,
        popupType: dto.popupType ?? null,
        popupCardId: dto.popupCardId ?? null,
        popupCardCtaLabel: dto.popupCardCtaLabel ?? null,
        popupImageCaption: dto.popupImageCaption ?? null,
      },
    });
  }

  async updatePage(
    user: AuthUser,
    pageId: string,
    patch: Partial<PageDto>,
    override?: string,
  ) {
    const tid = this.tid(user, override);
    const page = await this.prisma.menuBookPage.findUnique({
      where: { id: pageId },
      include: { section: { select: { tenantId: true } } },
    });
    if (!page || page.section.tenantId !== tid) {
      throw new NotFoundException('Página no encontrada');
    }
    const nextEnabled = patch.popupEnabled ?? page.popupEnabled;
    const nextType =
      patch.popupType === undefined ? page.popupType : patch.popupType;
    const nextCardId =
      patch.popupCardId === undefined ? page.popupCardId : patch.popupCardId;
    const nextButtonUrl =
      patch.popupButtonUrl === undefined
        ? page.popupButtonUrl
        : patch.popupButtonUrl;
    const nextImageUrl =
      patch.popupImageUrl === undefined ? page.popupImageUrl : patch.popupImageUrl;
    await this.validatePopupPayload(
      tid,
      nextEnabled,
      nextType,
      nextCardId,
      nextButtonUrl,
      nextImageUrl,
    );
    return this.prisma.menuBookPage.update({
      where: { id: pageId },
      data: {
        imageUrl: patch.imageUrl?.trim() ?? page.imageUrl,
        isActive: patch.isActive ?? page.isActive,
        popupEnabled: patch.popupEnabled ?? page.popupEnabled,
        popupTitle:
          patch.popupTitle === undefined ? page.popupTitle : patch.popupTitle,
        popupDescription:
          patch.popupDescription === undefined
            ? page.popupDescription
            : patch.popupDescription,
        popupImageUrl:
          patch.popupImageUrl === undefined
            ? page.popupImageUrl
            : patch.popupImageUrl
            ? safeUrlOrNull(patch.popupImageUrl) ?? null
            : null,
        popupButtonText:
          patch.popupButtonText === undefined
            ? page.popupButtonText
            : patch.popupButtonText,
        popupButtonUrl:
          patch.popupButtonUrl === undefined
            ? page.popupButtonUrl
            : patch.popupButtonUrl
            ? safeUrlOrNull(patch.popupButtonUrl) ?? null
            : null,
        popupButtonColor:
          patch.popupButtonColor === undefined
            ? page.popupButtonColor
            : patch.popupButtonColor,
        popupType:
          patch.popupType === undefined ? page.popupType : patch.popupType,
        popupCardId:
          patch.popupCardId === undefined ? page.popupCardId : patch.popupCardId,
        popupCardCtaLabel:
          patch.popupCardCtaLabel === undefined
            ? page.popupCardCtaLabel
            : patch.popupCardCtaLabel,
        popupImageCaption:
          patch.popupImageCaption === undefined
            ? page.popupImageCaption
            : patch.popupImageCaption,
      },
    });
  }

  async deletePage(user: AuthUser, pageId: string, override?: string) {
    const tid = this.tid(user, override);
    const page = await this.prisma.menuBookPage.findUnique({
      where: { id: pageId },
      include: { section: { select: { tenantId: true } } },
    });
    if (!page || page.section.tenantId !== tid) {
      throw new NotFoundException('Página no encontrada');
    }
    await this.prisma.menuBookPage.delete({ where: { id: pageId } });
    return { ok: true };
  }

  /** Reordena páginas dentro de una sección. */
  async reorderPages(
    user: AuthUser,
    sectionId: string,
    ids: string[],
    override?: string,
  ) {
    const tid = this.tid(user, override);
    const section = await this.prisma.menuBookSection.findUnique({
      where: { id: sectionId },
    });
    if (!section || section.tenantId !== tid) {
      throw new NotFoundException('Sección no encontrada');
    }
    const pages = await this.prisma.menuBookPage.findMany({
      where: { sectionId, id: { in: ids } },
      select: { id: true },
    });
    const validIds = new Set(pages.map((p) => p.id));
    await this.prisma.$transaction(
      ids
        .filter((id) => validIds.has(id))
        .map((id, idx) =>
          this.prisma.menuBookPage.update({
            where: { id },
            data: { sortOrder: idx },
          }),
        ),
    );
    return { ok: true, count: validIds.size };
  }
}
