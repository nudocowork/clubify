import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { AuthUser } from '../common/decorators/current-user.decorator';

/**
 * Cartas del negocio. Casi todos tienen una sola; los multi-sede pueden tener
 * varias, cada una asignada a su sede.
 *
 * **El menú principal no es una fila**: es todo lo que tiene `menuId = null`,
 * o sea lo que ya existía antes de que hubiera varias cartas. Así ningún
 * negocio se ve afectado hasta que alguien active la función, y si un día se
 * desactiva, su catálogo sigue exactamente donde estaba.
 *
 * Los menús son INDEPENDIENTES: duplicar copia el catálogo una vez, y desde
 * ahí cada uno va por su lado. Decisión explícita de Javier (2026-08-24)
 * sabiendo el coste; la alternativa evaluada era un catálogo único con
 * disponibilidad por sede.
 */
@Injectable()
export class MenusService {
  constructor(private prisma: PrismaService) {}

  private tid(user: AuthUser, override?: string) {
    if (user.role === 'SUPER_ADMIN') {
      if (!override) throw new ForbiddenException('tenantId required');
      return override;
    }
    if (!user.tenantId) throw new ForbiddenException();
    return user.tenantId;
  }

  /** El negocio tiene la función habilitada. La activa un admin, no él. */
  private async assertHabilitado(tenantId: string) {
    const t = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { multiMenuEnabled: true },
    });
    if (!t?.multiMenuEnabled) {
      throw new ForbiddenException(
        'Este negocio no tiene varias cartas habilitadas.',
      );
    }
  }

  /**
   * Las cartas del negocio, con el menú principal al frente.
   *
   * El principal se devuelve como una entrada con `id: null` para que el panel
   * pinte un selector uniforme sin saber que por dentro es la ausencia de
   * `menuId`.
   */
  async list(user: AuthUser, override?: string) {
    const tenantId = this.tid(user, override);
    const [tenant, menus] = await Promise.all([
      this.prisma.tenant.findUnique({
        where: { id: tenantId },
        select: { multiMenuEnabled: true },
      }),
      this.prisma.menu.findMany({
        where: { tenantId },
        orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
        include: { location: { select: { id: true, name: true } } },
      }),
    ]);

    const [catsPrincipal, prodsPrincipal] = await Promise.all([
      this.prisma.category.count({ where: { tenantId, menuId: null } }),
      this.prisma.product.count({ where: { tenantId, menuId: null } }),
    ]);

    const extras = await Promise.all(
      menus.map(async (m) => ({
        categorias: await this.prisma.category.count({
          where: { tenantId, menuId: m.id },
        }),
        productos: await this.prisma.product.count({
          where: { tenantId, menuId: m.id },
        }),
      })),
    );

    return {
      habilitado: !!tenant?.multiMenuEnabled,
      menus: [
        {
          id: null,
          name: 'Menú principal',
          locationId: null,
          locationName: null,
          esPrincipal: true,
          categorias: catsPrincipal,
          productos: prodsPrincipal,
        },
        ...menus.map((m, i) => ({
          id: m.id,
          name: m.name,
          locationId: m.locationId,
          locationName: m.location?.name ?? null,
          esPrincipal: false,
          categorias: extras[i].categorias,
          productos: extras[i].productos,
        })),
      ],
    };
  }

  /**
   * Crea una carta. Si `duplicarDe` viene, copia ese menú entero: categorías
   * (respetando el árbol padre/hijo), productos, variantes y extras.
   *
   * `duplicarDe: null` significa duplicar el menú principal — no "no
   * duplicar". Para una carta vacía se omite el campo.
   */
  async create(
    user: AuthUser,
    dto: {
      name: string;
      locationId?: string | null;
      duplicarDe?: string | null;
      duplicar?: boolean;
    },
    override?: string,
  ) {
    const tenantId = this.tid(user, override);
    await this.assertHabilitado(tenantId);

    const name = (dto.name ?? '').trim();
    if (name.length < 2) {
      throw new BadRequestException('Ponle un nombre a la carta.');
    }

    if (dto.locationId) {
      const sede = await this.prisma.location.findFirst({
        where: { id: dto.locationId, tenantId },
        select: { id: true },
      });
      if (!sede) throw new BadRequestException('Esa sede no es de este negocio.');
      // Una sede no puede tener dos cartas: el QR de la mesa no sabría cuál
      // abrir. El menú principal sirve a las sedes que no tengan carta propia.
      const ocupada = await this.prisma.menu.findFirst({
        where: { tenantId, locationId: dto.locationId },
        select: { name: true },
      });
      if (ocupada) {
        throw new BadRequestException(
          `Esa sede ya usa la carta "${ocupada.name}".`,
        );
      }
    }

    const ultimo = await this.prisma.menu.findFirst({
      where: { tenantId },
      orderBy: { position: 'desc' },
      select: { position: true },
    });

    const menu = await this.prisma.menu.create({
      data: {
        tenantId,
        name,
        locationId: dto.locationId ?? null,
        position: (ultimo?.position ?? 0) + 1,
      },
    });

    if (dto.duplicar) {
      await this.duplicarCatalogo(tenantId, dto.duplicarDe ?? null, menu.id);
    }

    return menu;
  }

  /**
   * Copia el catálogo de un menú a otro.
   *
   * Se hace en dos pasadas por las categorías porque tienen árbol: primero
   * todas sin padre, después se reconectan los padres con el mapa de ids
   * viejos → nuevos. Al revés, un hijo podría copiarse antes que su padre y
   * quedarse colgado.
   *
   * NO copia stock: el inventario es físico de cada sede y arrancar la carta
   * nueva con el stock de la otra sería dar por buenas existencias que no hay.
   */
  private async duplicarCatalogo(
    tenantId: string,
    origenMenuId: string | null,
    destinoMenuId: string,
  ) {
    const categorias = await this.prisma.category.findMany({
      where: { tenantId, menuId: origenMenuId },
      orderBy: { position: 'asc' },
    });
    const productos = await this.prisma.product.findMany({
      where: { tenantId, menuId: origenMenuId },
      orderBy: { position: 'asc' },
      include: { variants: true, extras: true },
    });

    if (!categorias.length && !productos.length) return;

    const mapaCat = new Map<string, string>();

    for (const c of categorias) {
      const nueva = await this.prisma.category.create({
        data: {
          tenantId,
          menuId: destinoMenuId,
          name: c.name,
          slug: c.slug,
          description: c.description,
          imageUrl: c.imageUrl,
          tagline: c.tagline,
          coverConfig: c.coverConfig ?? undefined,
          popupConfig: c.popupConfig ?? undefined,
          position: c.position,
          isActive: c.isActive,
          parentId: null,
        },
        select: { id: true },
      });
      mapaCat.set(c.id, nueva.id);
    }

    for (const c of categorias) {
      if (!c.parentId) continue;
      const nuevoPadre = mapaCat.get(c.parentId);
      const nuevaId = mapaCat.get(c.id);
      if (!nuevoPadre || !nuevaId) continue;
      await this.prisma.category.update({
        where: { id: nuevaId },
        data: { parentId: nuevoPadre },
      });
    }

    for (const p of productos) {
      await this.prisma.product.create({
        data: {
          tenantId,
          menuId: destinoMenuId,
          // Nace SIGUIENDO al original: cambiar el precio en el menú principal
          // lo cambia aquí también. El negocio lo desengancha cuando quiera
          // precios propios en esa sede. Lo que se muestra (visible, mesa,
          // domicilio, posición, stock) es local desde el minuto uno.
          sourceProductId: p.id,
          syncWithSource: true,
          categoryId: p.categoryId ? (mapaCat.get(p.categoryId) ?? null) : null,
          name: p.name,
          description: p.description,
          basePrice: p.basePrice,
          priceMode: p.priceMode,
          priceMax: p.priceMax,
          variantPriceMode: p.variantPriceMode,
          maxVariantsTotal: p.maxVariantsTotal,
          maxExtrasTotal: p.maxExtrasTotal,
          imageUrl: p.imageUrl,
          tags: p.tags,
          isAvailable: p.isAvailable,
          availableForMesa: p.availableForMesa,
          availableForDelivery: p.availableForDelivery,
          isRecommended: p.isRecommended,
          position: p.position,
          // Stock NO se copia: es físico de cada sede.
          variants: {
            create: p.variants.map((v) => ({
              groupName: v.groupName,
              name: v.name,
              priceDelta: v.priceDelta,
              isDefault: v.isDefault,
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
    }
  }

  async update(
    user: AuthUser,
    id: string,
    dto: { name?: string; locationId?: string | null; isActive?: boolean },
    override?: string,
  ) {
    const tenantId = this.tid(user, override);
    const menu = await this.prisma.menu.findFirst({
      where: { id, tenantId },
      select: { id: true },
    });
    if (!menu) throw new NotFoundException('Carta no encontrada');

    if (dto.locationId) {
      const ocupada = await this.prisma.menu.findFirst({
        where: { tenantId, locationId: dto.locationId, id: { not: id } },
        select: { name: true },
      });
      if (ocupada) {
        throw new BadRequestException(
          `Esa sede ya usa la carta "${ocupada.name}".`,
        );
      }
    }

    return this.prisma.menu.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.locationId !== undefined ? { locationId: dto.locationId } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
      },
    });
  }

  /**
   * Borra una carta Y su catálogo (cascada por FK).
   *
   * Pide el nombre exacto como confirmación: son productos reales con sus
   * fotos y precios, y no hay deshacer.
   */
  async remove(
    user: AuthUser,
    id: string,
    confirmacion: string,
    override?: string,
  ) {
    const tenantId = this.tid(user, override);
    const menu = await this.prisma.menu.findFirst({
      where: { id, tenantId },
      select: { id: true, name: true },
    });
    if (!menu) throw new NotFoundException('Carta no encontrada');

    if ((confirmacion ?? '').trim() !== menu.name) {
      throw new BadRequestException(
        `Para borrarla, escribe su nombre exacto: "${menu.name}".`,
      );
    }

    const productos = await this.prisma.product.count({
      where: { tenantId, menuId: id },
    });
    await this.prisma.menu.delete({ where: { id } });
    return { ok: true, productosBorrados: productos };
  }
}
