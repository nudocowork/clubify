import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { AuthUser } from '../common/decorators/current-user.decorator';

export type CreateIndustryDto = {
  name: string;
  slug?: string;
  description?: string | null;
  emoji?: string | null;
  iconUrl?: string | null;
  coverImage?: string | null;
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

  async getById(user: AuthUser, id: string) {
    this.ensureSuperAdmin(user);
    const row = await this.prisma.industry.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Industria no encontrada');
    return row;
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
