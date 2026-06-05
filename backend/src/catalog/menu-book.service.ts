import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { AuthUser } from '../common/decorators/current-user.decorator';
import { safeUrlOrNull } from '../common/util/safe-url';

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
        popupImageUrl: dto.popupImageUrl ?? null,
        popupButtonText: dto.popupButtonText ?? null,
        popupButtonUrl: dto.popupButtonUrl ? safeUrlOrNull(dto.popupButtonUrl) ?? null : null,
        popupButtonColor: dto.popupButtonColor ?? null,
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
            : patch.popupImageUrl,
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
        popupImageUrl: dto.popupImageUrl ?? null,
        popupButtonText: dto.popupButtonText ?? null,
        popupButtonUrl: dto.popupButtonUrl ? safeUrlOrNull(dto.popupButtonUrl) ?? null : null,
        popupButtonColor: dto.popupButtonColor ?? null,
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
    return this.prisma.menuBookPage.update({
      where: { id: pageId },
      data: {
        imageUrl: patch.imageUrl?.trim() ?? page.imageUrl,
        isActive: patch.isActive ?? page.isActive,
        popupEnabled: patch.popupEnabled ?? page.popupEnabled,
        popupTitle: patch.popupTitle ?? page.popupTitle,
        popupDescription: patch.popupDescription ?? page.popupDescription,
        popupImageUrl: patch.popupImageUrl ?? page.popupImageUrl,
        popupButtonText: patch.popupButtonText ?? page.popupButtonText,
        popupButtonUrl:
          patch.popupButtonUrl === undefined
            ? page.popupButtonUrl
            : patch.popupButtonUrl
            ? safeUrlOrNull(patch.popupButtonUrl) ?? null
            : null,
        popupButtonColor: patch.popupButtonColor ?? page.popupButtonColor,
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
