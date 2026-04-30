import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { AuthUser } from '../common/decorators/current-user.decorator';

export type VariantDto = {
  id?: string;
  groupName?: string;
  name: string;
  priceDelta: number;
  isDefault?: boolean;
  position?: number;
};

export type ExtraDto = {
  id?: string;
  name: string;
  price: number;
  maxQty?: number;
  isAvailable?: boolean;
};

export type ProductDto = {
  categoryId: string;
  name: string;
  description?: string;
  basePrice: number;
  imageUrl?: string;
  tags?: string[];
  isAvailable?: boolean;
  position?: number;
  variants?: VariantDto[];
  extras?: ExtraDto[];
};

@Injectable()
export class ProductsService {
  constructor(private prisma: PrismaService) {}

  private tid(user: AuthUser, override?: string) {
    if (user.role === 'SUPER_ADMIN') {
      if (!override) throw new ForbiddenException('tenantId required');
      return override;
    }
    if (!user.tenantId) throw new ForbiddenException();
    return user.tenantId;
  }

  list(user: AuthUser, override?: string, categoryId?: string) {
    const tid = this.tid(user, override);
    return this.prisma.product.findMany({
      where: { tenantId: tid, ...(categoryId ? { categoryId } : {}) },
      include: { variants: true, extras: true, category: true },
      orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
    });
  }

  async get(user: AuthUser, id: string) {
    const p = await this.prisma.product.findUnique({
      where: { id },
      include: { variants: true, extras: true, category: true },
    });
    if (!p) throw new NotFoundException();
    if (user.role !== 'SUPER_ADMIN' && p.tenantId !== user.tenantId) {
      throw new ForbiddenException();
    }
    return p;
  }

  async create(user: AuthUser, dto: ProductDto, override?: string) {
    const tid = this.tid(user, override);
    return this.prisma.product.create({
      data: {
        tenantId: tid,
        categoryId: dto.categoryId,
        name: dto.name,
        description: dto.description ?? '',
        basePrice: dto.basePrice,
        imageUrl: dto.imageUrl,
        tags: dto.tags ?? [],
        isAvailable: dto.isAvailable ?? true,
        position: dto.position ?? 0,
        variants: dto.variants
          ? {
              create: dto.variants.map((v) => ({
                groupName: v.groupName ?? 'Tamaño',
                name: v.name,
                priceDelta: v.priceDelta,
                isDefault: v.isDefault ?? false,
                position: v.position ?? 0,
              })),
            }
          : undefined,
        extras: dto.extras
          ? {
              create: dto.extras.map((e) => ({
                name: e.name,
                price: e.price,
                maxQty: e.maxQty ?? 1,
                isAvailable: e.isAvailable ?? true,
              })),
            }
          : undefined,
      },
      include: { variants: true, extras: true, category: true },
    });
  }

  async update(user: AuthUser, id: string, dto: Partial<ProductDto>) {
    const existing = await this.get(user, id);
    return this.prisma.$transaction(async (tx) => {
      // Update base
      const updated = await tx.product.update({
        where: { id },
        data: {
          categoryId: dto.categoryId ?? undefined,
          name: dto.name ?? undefined,
          description: dto.description ?? undefined,
          basePrice: dto.basePrice ?? undefined,
          imageUrl: dto.imageUrl ?? undefined,
          tags: dto.tags ?? undefined,
          isAvailable: dto.isAvailable ?? undefined,
          position: dto.position ?? undefined,
        },
      });
      // Replace variants if provided
      if (dto.variants) {
        await tx.productVariant.deleteMany({ where: { productId: id } });
        if (dto.variants.length) {
          await tx.productVariant.createMany({
            data: dto.variants.map((v) => ({
              productId: id,
              groupName: v.groupName ?? 'Tamaño',
              name: v.name,
              priceDelta: v.priceDelta,
              isDefault: v.isDefault ?? false,
              position: v.position ?? 0,
            })),
          });
        }
      }
      if (dto.extras) {
        await tx.productExtra.deleteMany({ where: { productId: id } });
        if (dto.extras.length) {
          await tx.productExtra.createMany({
            data: dto.extras.map((e) => ({
              productId: id,
              name: e.name,
              price: e.price,
              maxQty: e.maxQty ?? 1,
              isAvailable: e.isAvailable ?? true,
            })),
          });
        }
      }
      return tx.product.findUnique({
        where: { id },
        include: { variants: true, extras: true, category: true },
      });
    });
  }

  async remove(user: AuthUser, id: string) {
    await this.get(user, id);
    await this.prisma.product.delete({ where: { id } });
    return { ok: true };
  }

  async setAvailable(user: AuthUser, id: string, isAvailable: boolean) {
    await this.get(user, id);
    return this.prisma.product.update({
      where: { id },
      data: { isAvailable },
    });
  }

  async reorder(user: AuthUser, ids: string[]) {
    const tid = user.role === 'SUPER_ADMIN' ? null : user.tenantId;
    await this.prisma.$transaction(
      ids.map((id, position) =>
        this.prisma.product.updateMany({
          where: { id, ...(tid ? { tenantId: tid } : {}) },
          data: { position },
        }),
      ),
    );
    return { ok: true };
  }
}
