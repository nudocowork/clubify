import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, SlideAnimation, SlideLayout } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { AuthUser } from '../common/decorators/current-user.decorator';

export type CreatePresentationDto = {
  industryId: string;
  title: string;
  slug?: string;
  description?: string | null;
  coverImage?: string | null;
  themeColor?: string | null;
  isActive?: boolean;
  sortOrder?: number;
};

export type UpdatePresentationDto = Partial<
  Omit<CreatePresentationDto, 'industryId'>
>;

export type CreateSlideDto = {
  layout?: SlideLayout;
  sortOrder?: number;
  title?: string | null;
  subtitle?: string | null;
  body?: string | null;
  imageUrl?: string | null;
  videoUrl?: string | null;
  ctaText?: string | null;
  ctaUrl?: string | null;
  bgColor?: string | null;
  textColor?: string | null;
  animation?: SlideAnimation;
  content?: Prisma.InputJsonValue | null;
};

export type UpdateSlideDto = Partial<CreateSlideDto>;

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
export class PresentationsService {
  constructor(private prisma: PrismaService) {}

  private ensureSuperAdmin(user: AuthUser) {
    if (user.role !== 'SUPER_ADMIN') throw new ForbiddenException();
  }

  // ───────────── Presentations CRUD ───────────── //

  /** Admin — lista todas las presentations de una industria. */
  async listByIndustry(user: AuthUser, industryId: string) {
    this.ensureSuperAdmin(user);
    const industry = await this.prisma.industry.findUnique({
      where: { id: industryId },
      select: { id: true },
    });
    if (!industry) throw new NotFoundException('Industria no encontrada');
    return this.prisma.presentation.findMany({
      where: { industryId },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      include: {
        _count: { select: { slides: true } },
      },
    });
  }

  async getById(user: AuthUser, id: string) {
    this.ensureSuperAdmin(user);
    const row = await this.prisma.presentation.findUnique({
      where: { id },
      include: {
        industry: { select: { id: true, name: true, slug: true } },
        slides: { orderBy: { sortOrder: 'asc' } },
      },
    });
    if (!row) throw new NotFoundException('Presentación no encontrada');
    return row;
  }

  async create(user: AuthUser, dto: CreatePresentationDto) {
    this.ensureSuperAdmin(user);
    const title = (dto.title || '').trim();
    if (!title) throw new BadRequestException('title requerido');
    if (!dto.industryId) throw new BadRequestException('industryId requerido');
    const industry = await this.prisma.industry.findUnique({
      where: { id: dto.industryId },
      select: { id: true },
    });
    if (!industry) throw new NotFoundException('Industria no encontrada');
    const slug = (dto.slug?.trim() || slugify(title)) || slugify(title);
    if (!slug) {
      throw new BadRequestException(
        'No se pudo generar slug — pasá uno manualmente.',
      );
    }
    try {
      return await this.prisma.presentation.create({
        data: {
          industryId: dto.industryId,
          title,
          slug,
          description: dto.description?.trim() || null,
          coverImage: dto.coverImage?.trim() || null,
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
        throw new ConflictException(
          'Ya existe una presentación con ese slug en esta industria.',
        );
      }
      throw e;
    }
  }

  async update(user: AuthUser, id: string, dto: UpdatePresentationDto) {
    await this.getById(user, id);
    const data: Prisma.PresentationUpdateInput = {};
    if (dto.title !== undefined) {
      const t = dto.title.trim();
      if (!t) throw new BadRequestException('title no puede ser vacío');
      data.title = t;
    }
    if (dto.slug !== undefined) {
      const s = dto.slug.trim();
      if (!s) throw new BadRequestException('slug no puede ser vacío');
      data.slug = s;
    }
    if (dto.description !== undefined)
      data.description = dto.description?.trim() || null;
    if (dto.coverImage !== undefined)
      data.coverImage = dto.coverImage?.trim() || null;
    if (dto.themeColor !== undefined)
      data.themeColor = dto.themeColor?.trim() || null;
    if (dto.isActive !== undefined) data.isActive = dto.isActive;
    if (dto.sortOrder !== undefined) data.sortOrder = dto.sortOrder;
    try {
      return await this.prisma.presentation.update({ where: { id }, data });
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        throw new ConflictException(
          'Ya existe otra presentación con ese slug en esta industria.',
        );
      }
      throw e;
    }
  }

  async remove(user: AuthUser, id: string) {
    await this.getById(user, id);
    // Cascade en FK → borra todos sus slides también.
    await this.prisma.presentation.delete({ where: { id } });
    return { ok: true };
  }

  /** Duplica una presentation con todas sus slides — útil para arrancar
   *  un deck nuevo desde una plantilla existente. */
  async duplicate(user: AuthUser, id: string) {
    this.ensureSuperAdmin(user);
    const src = await this.prisma.presentation.findUnique({
      where: { id },
      include: { slides: { orderBy: { sortOrder: 'asc' } } },
    });
    if (!src) throw new NotFoundException('Presentación no encontrada');
    // Generamos slug único sufijando "-copia", "-copia-2", etc.
    let attempt = 1;
    let newSlug = `${src.slug}-copia`;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const exists = await this.prisma.presentation.findUnique({
        where: {
          industryId_slug: { industryId: src.industryId, slug: newSlug },
        },
        select: { id: true },
      });
      if (!exists) break;
      attempt += 1;
      newSlug = `${src.slug}-copia-${attempt}`;
    }
    return this.prisma.presentation.create({
      data: {
        industryId: src.industryId,
        title: `${src.title} (copia)`,
        slug: newSlug,
        description: src.description,
        coverImage: src.coverImage,
        themeColor: src.themeColor,
        isActive: false, // duplicada arranca inactiva para revisar
        sortOrder: src.sortOrder + 1,
        slides: {
          create: src.slides.map((s) => ({
            sortOrder: s.sortOrder,
            layout: s.layout,
            title: s.title,
            subtitle: s.subtitle,
            body: s.body,
            imageUrl: s.imageUrl,
            videoUrl: s.videoUrl,
            ctaText: s.ctaText,
            ctaUrl: s.ctaUrl,
            bgColor: s.bgColor,
            textColor: s.textColor,
            animation: s.animation,
            content: s.content === null ? Prisma.JsonNull : (s.content as any),
          })),
        },
      },
    });
  }

  /** Reordena presentations dentro de una industria. */
  async reorderPresentations(
    user: AuthUser,
    items: Array<{ id: string; sortOrder: number }>,
  ) {
    this.ensureSuperAdmin(user);
    if (!Array.isArray(items) || items.length === 0) return { ok: true };
    await this.prisma.$transaction(
      items.map((it) =>
        this.prisma.presentation.update({
          where: { id: it.id },
          data: { sortOrder: it.sortOrder },
        }),
      ),
    );
    return { ok: true };
  }

  // ───────────── Slides CRUD ───────────── //

  /** Lista todos los slides de una presentation, ordenados. */
  async listSlides(user: AuthUser, presentationId: string) {
    this.ensureSuperAdmin(user);
    const presentation = await this.prisma.presentation.findUnique({
      where: { id: presentationId },
      select: { id: true },
    });
    if (!presentation) throw new NotFoundException('Presentación no encontrada');
    return this.prisma.slide.findMany({
      where: { presentationId },
      orderBy: { sortOrder: 'asc' },
    });
  }

  async createSlide(
    user: AuthUser,
    presentationId: string,
    dto: CreateSlideDto,
  ) {
    this.ensureSuperAdmin(user);
    const presentation = await this.prisma.presentation.findUnique({
      where: { id: presentationId },
      select: { id: true },
    });
    if (!presentation) throw new NotFoundException('Presentación no encontrada');
    // Si no se pasa sortOrder, lo ponemos al final (último + 1).
    let order = dto.sortOrder;
    if (order === undefined || order === null) {
      const last = await this.prisma.slide.findFirst({
        where: { presentationId },
        orderBy: { sortOrder: 'desc' },
        select: { sortOrder: true },
      });
      order = (last?.sortOrder ?? -1) + 1;
    }
    return this.prisma.slide.create({
      data: {
        presentationId,
        sortOrder: order,
        layout: dto.layout ?? SlideLayout.COVER,
        title: dto.title?.trim() || null,
        subtitle: dto.subtitle?.trim() || null,
        body: dto.body ?? null,
        imageUrl: dto.imageUrl?.trim() || null,
        videoUrl: dto.videoUrl?.trim() || null,
        ctaText: dto.ctaText?.trim() || null,
        ctaUrl: dto.ctaUrl?.trim() || null,
        bgColor: dto.bgColor?.trim() || null,
        textColor: dto.textColor?.trim() || null,
        animation: dto.animation ?? SlideAnimation.NONE,
        content:
          dto.content === undefined || dto.content === null
            ? Prisma.JsonNull
            : (dto.content as any),
      },
    });
  }

  async getSlide(user: AuthUser, id: string) {
    this.ensureSuperAdmin(user);
    const row = await this.prisma.slide.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Slide no encontrado');
    return row;
  }

  async updateSlide(user: AuthUser, id: string, dto: UpdateSlideDto) {
    await this.getSlide(user, id);
    const data: Prisma.SlideUpdateInput = {};
    if (dto.sortOrder !== undefined) data.sortOrder = dto.sortOrder;
    if (dto.layout !== undefined) data.layout = dto.layout;
    if (dto.title !== undefined) data.title = dto.title?.trim() || null;
    if (dto.subtitle !== undefined)
      data.subtitle = dto.subtitle?.trim() || null;
    if (dto.body !== undefined) data.body = dto.body ?? null;
    if (dto.imageUrl !== undefined)
      data.imageUrl = dto.imageUrl?.trim() || null;
    if (dto.videoUrl !== undefined)
      data.videoUrl = dto.videoUrl?.trim() || null;
    if (dto.ctaText !== undefined) data.ctaText = dto.ctaText?.trim() || null;
    if (dto.ctaUrl !== undefined) data.ctaUrl = dto.ctaUrl?.trim() || null;
    if (dto.bgColor !== undefined) data.bgColor = dto.bgColor?.trim() || null;
    if (dto.textColor !== undefined)
      data.textColor = dto.textColor?.trim() || null;
    if (dto.animation !== undefined) data.animation = dto.animation;
    if (dto.content !== undefined)
      data.content =
        dto.content === null ? Prisma.JsonNull : (dto.content as any);
    return this.prisma.slide.update({ where: { id }, data });
  }

  async removeSlide(user: AuthUser, id: string) {
    await this.getSlide(user, id);
    await this.prisma.slide.delete({ where: { id } });
    return { ok: true };
  }

  /** Duplica un slide en la misma presentation, justo después del original. */
  async duplicateSlide(user: AuthUser, id: string) {
    this.ensureSuperAdmin(user);
    const src = await this.prisma.slide.findUnique({ where: { id } });
    if (!src) throw new NotFoundException('Slide no encontrado');
    // Lo ubicamos justo después del original (sortOrder + 0.5), pero
    // como sortOrder es Int hacemos shift de los siguientes en +1 antes
    // de insertar — así evitamos colisiones y mantenemos orden estable.
    await this.prisma.slide.updateMany({
      where: {
        presentationId: src.presentationId,
        sortOrder: { gt: src.sortOrder },
      },
      data: { sortOrder: { increment: 1 } },
    });
    return this.prisma.slide.create({
      data: {
        presentationId: src.presentationId,
        sortOrder: src.sortOrder + 1,
        layout: src.layout,
        title: src.title,
        subtitle: src.subtitle,
        body: src.body,
        imageUrl: src.imageUrl,
        videoUrl: src.videoUrl,
        ctaText: src.ctaText,
        ctaUrl: src.ctaUrl,
        bgColor: src.bgColor,
        textColor: src.textColor,
        animation: src.animation,
        content:
          src.content === null ? Prisma.JsonNull : (src.content as any),
      },
    });
  }

  /** Reordena slides dentro de una presentation — drag&drop batch. */
  async reorderSlides(
    user: AuthUser,
    items: Array<{ id: string; sortOrder: number }>,
  ) {
    this.ensureSuperAdmin(user);
    if (!Array.isArray(items) || items.length === 0) return { ok: true };
    await this.prisma.$transaction(
      items.map((it) =>
        this.prisma.slide.update({
          where: { id: it.id },
          data: { sortOrder: it.sortOrder },
        }),
      ),
    );
    return { ok: true };
  }
}
