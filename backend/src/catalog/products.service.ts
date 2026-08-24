import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
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
  // null/undefined → producto sin categoría (Bloque 2 2026-06-12).
  categoryId?: string | null;
  name: string;
  description?: string;
  basePrice: number;
  /** "FIXED" (default) o "RANGE". RANGE muestra "Desde X — hasta Y". */
  priceMode?: 'FIXED' | 'RANGE';
  /** Solo aplica cuando priceMode='RANGE'. null = sin máximo (fallback FIXED). */
  priceMax?: number | null;
  /**
   * "DELTA" (default): variantes suman priceDelta al basePrice.
   * "ABSOLUTE": cada variante define su precio propio (priceDelta = precio final).
   */
  variantPriceMode?: 'DELTA' | 'ABSOLUTE';
  /**
   * Cuantas variantes puede marcar el cliente. null o 1 = una sola (radio).
   * >= 2 = casillas multiples. Solo tiene efecto en modo DELTA.
   */
  /** Carta a la que pertenece. null/undefined = menu principal. */
  menuId?: string | null;
  maxVariantsTotal?: number | null;
  /**
   * Tope de extras EN TOTAL para este producto (sumando cantidades).
   * null = sin tope. Distinto de ProductExtra.maxQty, que limita UN extra.
   */
  maxExtrasTotal?: number | null;
  imageUrl?: string;
  tags?: string[];
  isAvailable?: boolean;
  availableForMesa?: boolean;
  availableForDelivery?: boolean;
  isRecommended?: boolean;
  position?: number;
  stock?: number | null;
  stockAlert?: number | null;
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

  /**
   * @param menuId carta que se esta editando. `undefined` = el menú
   *        principal (`menuId: null`), que es donde vive todo el catalogo de
   *        siempre. Sin este filtro, un negocio con dos cartas veria los
   *        productos de ambas mezclados en el panel.
   */
  list(
    user: AuthUser,
    override?: string,
    categoryId?: string,
    menuId?: string,
  ) {
    const tid = this.tid(user, override);
    return this.prisma.product.findMany({
      where: {
        tenantId: tid,
        menuId: menuId ?? null,
        ...(categoryId ? { categoryId } : {}),
      },
      include: {
        variants: true,
        extras: true,
        category: true,
        // El panel necesita saber si este producto sigue al original y si el
        // original todavia existe, para pintar el interruptor de sincronia.
        sourceProduct: { select: { id: true, name: true } },
      },
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
        // La carta que se esta editando. Sin esto, un producto creado desde la
        // carta de la sede 2 aparecia en el menu principal.
        menuId: dto.menuId ?? null,
        categoryId: dto.categoryId ?? null,
        name: dto.name,
        description: dto.description ?? '',
        basePrice: dto.basePrice,
        priceMode: dto.priceMode ?? 'FIXED',
        priceMax:
          dto.priceMode === 'RANGE' && dto.priceMax != null
            ? dto.priceMax
            : null,
        variantPriceMode: dto.variantPriceMode ?? 'DELTA',
        maxVariantsTotal:
          dto.maxVariantsTotal != null && dto.maxVariantsTotal > 1
            ? Math.floor(dto.maxVariantsTotal)
            : null,
        maxExtrasTotal:
          dto.maxExtrasTotal != null && dto.maxExtrasTotal > 0
            ? Math.floor(dto.maxExtrasTotal)
            : null,
        imageUrl: dto.imageUrl,
        tags: dto.tags ?? [],
        isAvailable: dto.isAvailable ?? true,
        availableForMesa: dto.availableForMesa ?? true,
        availableForDelivery: dto.availableForDelivery ?? true,
        isRecommended: dto.isRecommended ?? false,
        position: dto.position ?? 0,
        stock: dto.stock ?? null,
        stockAlert: dto.stockAlert ?? null,
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
          // categoryId: si el caller mandó null explícito, limpiamos
          // (producto sin categoría). undefined = no tocar el valor existente.
          categoryId:
            dto.categoryId === null
              ? null
              : dto.categoryId !== undefined
              ? dto.categoryId
              : undefined,
          name: dto.name ?? undefined,
          description: dto.description ?? undefined,
          basePrice: dto.basePrice ?? undefined,
          priceMode: dto.priceMode ?? undefined,
          // priceMax depende del modo elegido: si el caller pisó priceMode
          // a FIXED, limpiamos el max; si pasó RANGE con un número, lo
          // guardamos; si no tocó nada, undefined deja el valor previo.
          priceMax:
            dto.priceMode === 'FIXED'
              ? null
              : dto.priceMax === undefined
              ? undefined
              : dto.priceMax,
          variantPriceMode: dto.variantPriceMode ?? undefined,
          // 1 se guarda como null: "elige una" es el comportamiento por
          // defecto, no un tope que haya que recordar.
          maxVariantsTotal:
            dto.maxVariantsTotal === undefined
              ? undefined
              : dto.maxVariantsTotal != null && dto.maxVariantsTotal > 1
                ? Math.floor(dto.maxVariantsTotal)
                : null,
          // null explicito = quitar el tope; undefined = no tocarlo. Un `??`
          // aqui haria imposible volver a "sin tope" desde el panel.
          maxExtrasTotal:
            dto.maxExtrasTotal === undefined
              ? undefined
              : dto.maxExtrasTotal != null && dto.maxExtrasTotal > 0
                ? Math.floor(dto.maxExtrasTotal)
                : null,
          imageUrl: dto.imageUrl ?? undefined,
          tags: dto.tags ?? undefined,
          isAvailable: dto.isAvailable ?? undefined,
          availableForMesa: dto.availableForMesa ?? undefined,
          availableForDelivery: dto.availableForDelivery ?? undefined,
          isRecommended: dto.isRecommended ?? undefined,
          position: dto.position ?? undefined,
          stock: dto.stock === undefined ? undefined : dto.stock,
          stockAlert: dto.stockAlert === undefined ? undefined : dto.stockAlert,
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
      // Propagar a las copias SINCRONIZADAS de otras cartas.
      //
      // Se hace al ESCRIBIR y no al leer a proposito: el menu publico es la
      // consulta mas caliente del producto y resolver el original en cada
      // lectura la encarecia para todos, incluidos los negocios de una sola
      // carta, que son la inmensa mayoria.
      await this.propagarASincronizados(tx, id, dto);

      return tx.product.findUnique({
        where: { id },
        include: { variants: true, extras: true, category: true },
      });
    });
  }

  /**
   * Copia a las copias sincronizadas lo que define QUE ES el producto.
   *
   * NO se propaga como se MUESTRA en cada carta — visible, mesa, domicilio,
   * destacado, posicion, categoria y stock son de cada sede. Ese es el punto
   * entero de tener dos cartas: la sede B esconde lo que no tiene sin dejar de
   * recibir los cambios de precio del menu principal.
   *
   * Las variantes y extras se reemplazan enteras cuando vienen en el dto,
   * igual que en el producto original.
   */
  private async propagarASincronizados(
    tx: any,
    sourceId: string,
    dto: Partial<ProductDto>,
  ) {
    const copias = await tx.product.findMany({
      where: { sourceProductId: sourceId, syncWithSource: true },
      select: { id: true },
    });
    if (!copias.length) return;

    const compartido: Record<string, unknown> = {};
    const campos = [
      'name',
      'description',
      'basePrice',
      'priceMode',
      'priceMax',
      'variantPriceMode',
      'maxVariantsTotal',
      'maxExtrasTotal',
      'imageUrl',
      'tags',
    ] as const;
    for (const k of campos) {
      if ((dto as any)[k] !== undefined) compartido[k] = (dto as any)[k];
    }

    for (const copia of copias) {
      if (Object.keys(compartido).length) {
        await tx.product.update({ where: { id: copia.id }, data: compartido });
      }
      if (dto.variants) {
        await tx.productVariant.deleteMany({ where: { productId: copia.id } });
        if (dto.variants.length) {
          await tx.productVariant.createMany({
            data: dto.variants.map((v) => ({
              productId: copia.id,
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
        await tx.productExtra.deleteMany({ where: { productId: copia.id } });
        if (dto.extras.length) {
          await tx.productExtra.createMany({
            data: dto.extras.map((e) => ({
              productId: copia.id,
              name: e.name,
              price: e.price,
              maxQty: e.maxQty ?? 1,
              isAvailable: e.isAvailable ?? true,
            })),
          });
        }
      }
    }
  }

  /**
   * Engancha o desengancha una copia del producto original.
   *
   * Al enganchar se traen de una vez los datos del original, para que no quede
   * a medias: el negocio espera ver el precio del menu principal en cuanto lo
   * activa, no en el proximo cambio.
   */
  async setSync(user: AuthUser, id: string, sync: boolean) {
    const p = await this.get(user, id);
    if (!p.sourceProductId) {
      throw new BadRequestException(
        'Este producto no salió de otra carta, no hay nada con que sincronizarlo.',
      );
    }
    if (sync) {
      const origen = await this.prisma.product.findUnique({
        where: { id: p.sourceProductId },
        include: { variants: true, extras: true },
      });
      if (!origen) {
        throw new BadRequestException(
          'El producto original ya no existe. Este queda independiente.',
        );
      }
      await this.prisma.$transaction(async (tx) => {
        await tx.product.update({
          where: { id },
          data: {
            syncWithSource: true,
            name: origen.name,
            description: origen.description,
            basePrice: origen.basePrice,
            priceMode: origen.priceMode,
            priceMax: origen.priceMax,
            variantPriceMode: origen.variantPriceMode,
            maxVariantsTotal: origen.maxVariantsTotal,
            maxExtrasTotal: origen.maxExtrasTotal,
            imageUrl: origen.imageUrl,
            tags: origen.tags,
          },
        });
        await tx.productVariant.deleteMany({ where: { productId: id } });
        if (origen.variants.length) {
          await tx.productVariant.createMany({
            data: origen.variants.map((v) => ({
              productId: id,
              groupName: v.groupName,
              name: v.name,
              priceDelta: v.priceDelta,
              isDefault: v.isDefault,
              position: v.position,
            })),
          });
        }
        await tx.productExtra.deleteMany({ where: { productId: id } });
        if (origen.extras.length) {
          await tx.productExtra.createMany({
            data: origen.extras.map((e) => ({
              productId: id,
              name: e.name,
              price: e.price,
              maxQty: e.maxQty,
              isAvailable: e.isAvailable,
            })),
          });
        }
      });
    } else {
      await this.prisma.product.update({
        where: { id },
        data: { syncWithSource: false },
      });
    }
    return this.get(user, id);
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
