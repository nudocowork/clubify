import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { AuthUser } from '../common/decorators/current-user.decorator';

function slugify(s: string) {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 60);
}

export type CategoryDto = {
  name: string;
  parentId?: string | null;
  description?: string;
  imageUrl?: string;
  position?: number;
  /** Subtítulo corto debajo del nombre en la portada (~80 char). */
  tagline?: string | null;
  /** Config del banner editable (drag/drop, overlay, fuente, etc).
   *  Estructura libre — la valida el frontend. Backend persiste como
   *  JSONB. Null = fallback legacy. */
  coverConfig?: Record<string, any> | null;
};

@Injectable()
export class CategoriesService {
  constructor(private prisma: PrismaService) {}

  private tid(user: AuthUser, override?: string) {
    if (user.role === 'SUPER_ADMIN') {
      if (!override) throw new ForbiddenException('tenantId required');
      return override;
    }
    if (!user.tenantId) throw new ForbiddenException();
    return user.tenantId;
  }

  list(user: AuthUser, override?: string) {
    const tid = this.tid(user, override);
    return this.prisma.category.findMany({
      where: { tenantId: tid },
      include: {
        _count: { select: { products: true } },
        children: true,
      },
      orderBy: [{ parentId: 'asc' }, { position: 'asc' }, { createdAt: 'asc' }],
    });
  }

  async create(user: AuthUser, dto: CategoryDto, override?: string) {
    const tid = this.tid(user, override);
    const slug = slugify(dto.name) || `cat-${Date.now()}`;
    const last = await this.prisma.category.findFirst({
      where: { tenantId: tid, parentId: dto.parentId ?? null },
      orderBy: { position: 'desc' },
    });
    return this.prisma.category.create({
      data: {
        tenantId: tid,
        parentId: dto.parentId ?? null,
        name: dto.name,
        slug,
        description: dto.description,
        imageUrl: dto.imageUrl,
        tagline: dto.tagline ?? null,
        coverConfig: dto.coverConfig ?? undefined,
        position: dto.position ?? (last?.position ?? -1) + 1,
      },
    });
  }

  async update(user: AuthUser, id: string, dto: Partial<CategoryDto>) {
    const c = await this.prisma.category.findUnique({ where: { id } });
    if (!c) throw new NotFoundException();
    if (user.role !== 'SUPER_ADMIN' && c.tenantId !== user.tenantId) {
      throw new ForbiddenException();
    }
    return this.prisma.category.update({
      where: { id },
      data: {
        ...dto,
        parentId: dto.parentId === undefined ? undefined : dto.parentId,
        // Prisma JSON: undefined = no-op, null = set NULL en DB. Mapear
        // explícito para que el cliente pueda "limpiar" el coverConfig
        // mandando null (vuelve al fallback legacy).
        coverConfig:
          dto.coverConfig === undefined
            ? undefined
            : (dto.coverConfig as any),
      },
    });
  }

  async remove(user: AuthUser, id: string) {
    const c = await this.prisma.category.findUnique({ where: { id } });
    if (!c) throw new NotFoundException();
    if (user.role !== 'SUPER_ADMIN' && c.tenantId !== user.tenantId) {
      throw new ForbiddenException();
    }
    await this.prisma.category.delete({ where: { id } });
    return { ok: true };
  }

  async reorder(user: AuthUser, ids: string[]) {
    const tid =
      user.role === 'SUPER_ADMIN' ? null : user.tenantId;
    await this.prisma.$transaction(
      ids.map((id, position) =>
        this.prisma.category.updateMany({
          where: { id, ...(tid ? { tenantId: tid } : {}) },
          data: { position },
        }),
      ),
    );
    return { ok: true };
  }
}
