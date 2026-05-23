import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { IndustryCoverStyle, Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { AuthUser } from '../common/decorators/current-user.decorator';

export type CreateIndustryDto = {
  name: string;
  slug?: string;
  description?: string | null;
  emoji?: string | null;
  iconUrl?: string | null;
  coverImage?: string | null;
  coverStyle?: IndustryCoverStyle;
  themeColor?: string | null;
  isActive?: boolean;
  sortOrder?: number;
};

export type UpdateIndustryDto = Partial<CreateIndustryDto>;

/** Slugify simple — minúsculas, ASCII, guiones. Suficiente para los
 *  nombres de industria (cafeterías → cafeterias). Acepta acentos
 *  comunes y emoji al inicio (se descartan). */
function slugify(s: string): string {
  return (s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

@Injectable()
export class IndustriesService {
  constructor(private prisma: PrismaService) {}

  private ensureSuperAdmin(user: AuthUser) {
    if (user.role !== 'SUPER_ADMIN') throw new ForbiddenException();
  }

  /** Admin — lista todas (activas e inactivas) ordenadas por sortOrder. */
  async listAll(user: AuthUser) {
    this.ensureSuperAdmin(user);
    return this.prisma.industry.findMany({
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
  }

  /** Público — solo industrias activas, sin filtros admin. Sin role check
   *  porque el controller usa @Public(). */
  async listPublic() {
    return this.prisma.industry.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      select: {
        id: true,
        name: true,
        slug: true,
        description: true,
        emoji: true,
        iconUrl: true,
        coverImage: true,
        coverStyle: true,
        themeColor: true,
      },
    });
  }

  /** Público — industria + sus presentaciones activas (sin slides para
   *  no inflar). El detalle de cada presentation se trae aparte. */
  /**
   * Deck unificado por industria: devuelve la industria + TODOS los slides
   * de TODAS las presentations activas concatenados en un solo array. El
   * orden global es presentation.sortOrder → slide.sortOrder.
   *
   * Reemplaza la pantalla intermedia "lista de presentations" — el usuario
   * abre la industria y ve los slides directo. Si la industria tiene
   * múltiples presentations, sus slides aparecen secuenciados en el deck.
   *
   * Cada slide incluye `presentationSlug` y `presentationTitle` para que el
   * frontend pueda mostrar separadores/chips por presentation si quiere.
   */
  async getDeckBySlugPublic(slug: string) {
    const row = await this.prisma.industry.findUnique({
      where: { slug },
      select: {
        id: true,
        name: true,
        slug: true,
        description: true,
        emoji: true,
        iconUrl: true,
        coverImage: true,
        coverStyle: true,
        themeColor: true,
        isActive: true,
        presentations: {
          where: { isActive: true },
          orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
          select: {
            id: true,
            title: true,
            slug: true,
            sortOrder: true,
            slides: {
              orderBy: { sortOrder: 'asc' },
              select: {
                id: true,
                sortOrder: true,
                layout: true,
                title: true,
                subtitle: true,
                body: true,
                imageUrl: true,
                videoUrl: true,
                ctaText: true,
                ctaUrl: true,
                bgColor: true,
                textColor: true,
                animation: true,
                content: true,
              },
            },
          },
        },
      },
    });
    if (!row || !row.isActive) {
      throw new NotFoundException('Industria no encontrada');
    }
    // Flat array: cada slide con su origen de presentation para chips opcionales
    const slides = row.presentations.flatMap((p) =>
      p.slides.map((s) => ({
        ...s,
        presentationId: p.id,
        presentationSlug: p.slug,
        presentationTitle: p.title,
      })),
    );
    return {
      id: row.id,
      name: row.name,
      slug: row.slug,
      description: row.description,
      emoji: row.emoji,
      iconUrl: row.iconUrl,
      coverImage: row.coverImage,
      coverStyle: row.coverStyle,
      themeColor: row.themeColor,
      presentations: row.presentations.map((p) => ({
        id: p.id,
        title: p.title,
        slug: p.slug,
        slideCount: p.slides.length,
      })),
      slides,
    };
  }

  async getBySlugPublic(slug: string) {
    const row = await this.prisma.industry.findUnique({
      where: { slug },
      select: {
        id: true,
        name: true,
        slug: true,
        description: true,
        emoji: true,
        iconUrl: true,
        coverImage: true,
        themeColor: true,
        isActive: true,
        presentations: {
          where: { isActive: true },
          orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
          select: {
            id: true,
            title: true,
            slug: true,
            description: true,
            coverImage: true,
            themeColor: true,
            _count: { select: { slides: true } },
          },
        },
      },
    });
    if (!row || !row.isActive) {
      throw new NotFoundException('Industria no encontrada');
    }
    // Stripeamos isActive del payload — el cliente público no lo necesita.
    const { isActive: _isActive, ...rest } = row;
    return rest;
  }

  async getById(user: AuthUser, id: string) {
    this.ensureSuperAdmin(user);
    const row = await this.prisma.industry.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Industria no encontrada');
    return row;
  }

  /**
   * Asegura que la industria tenga al menos UNA Presentation "default"
   * y devuelve sus datos básicos. Si la industria no tiene ninguna, la
   * crea on-demand con slug = industry.slug, title = industry.name,
   * sortOrder=0, isActive=true.
   *
   * Usado por el admin frontend para colapsar la UX:
   * /admin/industries/{id} ahora redirige directo al editor de slides
   * de esta presentation default — sin pantalla intermedia "lista de
   * presentations". Conceptualmente cada industria tiene un solo deck;
   * Presentation queda como detalle de implementación interno.
   *
   * Idempotente: si ya existe una presentation, devuelve la primera por
   * sortOrder sin crear nada.
   */
  async ensureDefaultPresentation(user: AuthUser, industryId: string) {
    this.ensureSuperAdmin(user);
    const industry = await this.prisma.industry.findUnique({
      where: { id: industryId },
      select: { id: true, name: true, slug: true, themeColor: true },
    });
    if (!industry) throw new NotFoundException('Industria no encontrada');

    const existing = await this.prisma.presentation.findFirst({
      where: { industryId },
      orderBy: { sortOrder: 'asc' },
      select: { id: true, slug: true, title: true },
    });
    if (existing) return existing;

    // Slug derivado del industry.slug. Si por raro motivo ya existe una
    // Presentation con ese slug en esta industria (ej: el usuario la
    // creó manualmente y luego la desactivó), sufijamos para no
    // colisionar con el unique compuesto (industryId, slug).
    let candidateSlug = industry.slug;
    let attempt = 1;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const clash = await this.prisma.presentation.findUnique({
        where: {
          industryId_slug: { industryId, slug: candidateSlug },
        },
        select: { id: true },
      });
      if (!clash) break;
      attempt += 1;
      candidateSlug = `${industry.slug}-${attempt}`;
    }

    return this.prisma.presentation.create({
      data: {
        industryId,
        title: industry.name,
        slug: candidateSlug,
        themeColor: industry.themeColor,
        isActive: true,
        sortOrder: 0,
      },
      select: { id: true, slug: true, title: true },
    });
  }

  async create(user: AuthUser, dto: CreateIndustryDto) {
    this.ensureSuperAdmin(user);
    const name = (dto.name || '').trim();
    if (!name) throw new BadRequestException('name requerido');
    const slug = (dto.slug?.trim() || slugify(name)) || slugify(name);
    if (!slug) {
      throw new BadRequestException(
        'No se pudo generar slug — pasá uno manualmente.',
      );
    }
    try {
      return await this.prisma.industry.create({
        data: {
          name,
          slug,
          description: dto.description?.trim() || null,
          emoji: dto.emoji?.trim() || null,
          iconUrl: dto.iconUrl?.trim() || null,
          coverImage: dto.coverImage?.trim() || null,
          coverStyle: dto.coverStyle ?? undefined,
          themeColor: dto.themeColor?.trim() || null,
          isActive: dto.isActive ?? true,
          sortOrder: dto.sortOrder ?? 0,
        },
      });
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        const target = (e.meta as any)?.target?.toString() || '';
        const field = target.includes('slug') ? 'slug' : 'name';
        throw new ConflictException(
          `Ya existe una industria con ese ${field}.`,
        );
      }
      throw e;
    }
  }

  async update(user: AuthUser, id: string, dto: UpdateIndustryDto) {
    await this.getById(user, id);
    const data: Prisma.IndustryUpdateInput = {};
    if (dto.name !== undefined) {
      const n = dto.name.trim();
      if (!n) throw new BadRequestException('name no puede ser vacío');
      data.name = n;
    }
    if (dto.slug !== undefined) {
      const s = dto.slug.trim();
      if (!s) throw new BadRequestException('slug no puede ser vacío');
      data.slug = s;
    }
    if (dto.description !== undefined)
      data.description = dto.description?.trim() || null;
    if (dto.emoji !== undefined) data.emoji = dto.emoji?.trim() || null;
    if (dto.iconUrl !== undefined) data.iconUrl = dto.iconUrl?.trim() || null;
    if (dto.coverImage !== undefined)
      data.coverImage = dto.coverImage?.trim() || null;
    if (dto.coverStyle !== undefined) data.coverStyle = dto.coverStyle;
    if (dto.themeColor !== undefined)
      data.themeColor = dto.themeColor?.trim() || null;
    if (dto.isActive !== undefined) data.isActive = dto.isActive;
    if (dto.sortOrder !== undefined) data.sortOrder = dto.sortOrder;
    try {
      return await this.prisma.industry.update({ where: { id }, data });
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        const target = (e.meta as any)?.target?.toString() || '';
        const field = target.includes('slug') ? 'slug' : 'name';
        throw new ConflictException(
          `Ya existe otra industria con ese ${field}.`,
        );
      }
      throw e;
    }
  }

  async remove(user: AuthUser, id: string) {
    await this.getById(user, id);
    // F2 va a agregar Presentations con FK a Industry — cuando llegue,
    // este delete debería decidir entre cascade vs guard. Por ahora,
    // borrar libre (no hay deps).
    await this.prisma.industry.delete({ where: { id } });
    return { ok: true };
  }

  /** Reordena en batch — el admin drag&drop manda [{id, sortOrder}]. */
  async reorder(
    user: AuthUser,
    items: Array<{ id: string; sortOrder: number }>,
  ) {
    this.ensureSuperAdmin(user);
    if (!Array.isArray(items) || items.length === 0) return { ok: true };
    await this.prisma.$transaction(
      items.map((it) =>
        this.prisma.industry.update({
          where: { id: it.id },
          data: { sortOrder: it.sortOrder },
        }),
      ),
    );
    return { ok: true };
  }
}
