import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PromotionType } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { AuthUser } from '../common/decorators/current-user.decorator';

export type PromoDto = {
  name: string;
  description?: string;
  imageUrl?: string;
  type: PromotionType;
  value: number;
  originalPrice?: number;
  conditions?: any;
  validFrom?: string;
  validUntil?: string;
  maxRedemptions?: number;
  maxRedemptionsPerCustomer?: number;
  isActive?: boolean;
};

@Injectable()
export class PromotionsService {
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
    return this.prisma.promotion.findMany({
      where: { tenantId: tid },
      orderBy: { createdAt: 'desc' },
    });
  }

  create(user: AuthUser, dto: PromoDto, override?: string) {
    const tid = this.tid(user, override);
    return this.prisma.promotion.create({
      data: {
        tenantId: tid,
        name: dto.name,
        description: dto.description ?? '',
        imageUrl: dto.imageUrl ?? null,
        type: dto.type,
        value: dto.value,
        originalPrice: dto.originalPrice ?? null,
        conditions: dto.conditions ?? {},
        validFrom: dto.validFrom ? new Date(dto.validFrom) : null,
        validUntil: dto.validUntil ? new Date(dto.validUntil) : null,
        maxRedemptions: dto.maxRedemptions,
        maxRedemptionsPerCustomer: dto.maxRedemptionsPerCustomer,
        isActive: dto.isActive ?? true,
      },
    });
  }

  async update(user: AuthUser, id: string, dto: Partial<PromoDto>) {
    const p = await this.prisma.promotion.findUnique({ where: { id } });
    if (!p) throw new NotFoundException();
    if (user.role !== 'SUPER_ADMIN' && p.tenantId !== user.tenantId) {
      throw new ForbiddenException();
    }
    return this.prisma.promotion.update({
      where: { id },
      data: {
        ...dto,
        validFrom: dto.validFrom ? new Date(dto.validFrom) : undefined,
        validUntil: dto.validUntil ? new Date(dto.validUntil) : undefined,
      },
    });
  }

  async remove(user: AuthUser, id: string) {
    const p = await this.prisma.promotion.findUnique({ where: { id } });
    if (!p) throw new NotFoundException();
    if (user.role !== 'SUPER_ADMIN' && p.tenantId !== user.tenantId) {
      throw new ForbiddenException();
    }
    await this.prisma.promotion.delete({ where: { id } });
    return { ok: true };
  }

  /** Calcula descuentos automáticos aplicables a un carrito. */
  async computeForCart(
    tenantId: string,
    subtotal: number,
    items: any[],
  ): Promise<{ discount: number; applied: any[] }> {
    const now = new Date();
    const promos = await this.prisma.promotion.findMany({
      where: {
        tenantId,
        isActive: true,
        OR: [{ validFrom: null }, { validFrom: { lte: now } }],
        AND: [
          { OR: [{ validUntil: null }, { validUntil: { gte: now } }] },
        ],
      },
    });

    let discount = 0;
    const applied: any[] = [];

    for (const p of promos) {
      const cond = (p.conditions as any) || {};

      // Skip "descuento fantasma": una promo DISCOUNT_AMOUNT/PCT SIN
      // `productIds` es una promo de PRODUCTO (precio promo para mostrar en
      // el menú) o una promo mal configurada — NO un descuento auto-aplicable
      // a TODO el carrito. Si se dejara pasar, `saved = min(value, subtotal)`
      // descuenta el "precio promo" de cada pedido → descuentos inexplicables
      // (Piatto Presto restaba -$52 a todo el carrito; Nudo Cowork igual).
      // ANTES el guard exigía `originalPrice !== null`, pero el formulario deja
      // "Precio regular" opcional → con originalPrice=null el guard no atrapaba
      // la promo y volvía el descuento fantasma (PDF454). Ahora: un descuento
      // solo se aplica al carrito si tiene `productIds` explícito en conditions.
      if (
        (p.type === 'DISCOUNT_AMOUNT' || p.type === 'DISCOUNT_PCT') &&
        !cond.productIds?.length
      ) {
        continue;
      }

      // Condiciones simples
      if (cond.minSubtotal && subtotal < Number(cond.minSubtotal)) continue;
      if (cond.daysOfWeek && Array.isArray(cond.daysOfWeek) && cond.daysOfWeek.length) {
        const dow = now.getDay();
        if (!cond.daysOfWeek.includes(dow)) continue;
      }
      if (cond.hourFrom !== undefined && cond.hourTo !== undefined) {
        const h = now.getHours();
        if (h < cond.hourFrom || h >= cond.hourTo) continue;
      }
      if (cond.productIds?.length) {
        const has = items.some((i) => cond.productIds.includes(i.productId));
        if (!has) continue;
      }

      // FIX 2026-06-16 (review #6): si la promo está scopeada a productIds,
      // el descuento aplica SOLO sobre la suma de esos productos, no sobre
      // todo el carrito. Antes "20% off cafés" descontaba 20% de cafés +
      // hamburguesas + todo.
      const scopedBase = cond.productIds?.length
        ? items
            .filter((i) => cond.productIds.includes(i.productId))
            .reduce((s, i) => s + Number(i.unitPrice) * Number(i.qty ?? 1), 0)
        : subtotal;

      let saved = 0;
      switch (p.type) {
        case 'DISCOUNT_PCT':
          saved = scopedBase * (Number(p.value) / 100);
          break;
        case 'DISCOUNT_AMOUNT':
          saved = Math.min(Number(p.value), scopedBase);
          break;
        case 'FREE_ITEM':
          // Resta el item de menor precio que cumpla
          if (cond.productIds?.length) {
            const candidates = items.filter((i) =>
              cond.productIds.includes(i.productId),
            );
            const cheapest = candidates.reduce(
              (m, i) => (m && m.unitPrice < i.unitPrice ? m : i),
              null as any,
            );
            if (cheapest) saved = cheapest.unitPrice;
          }
          break;
        case 'BUY_X_GET_Y':
          // Simplificado: compra X (cond.x), lleva Y (cond.y) gratis
          if (cond.productId && cond.x && cond.y) {
            const it = items.find((i) => i.productId === cond.productId);
            if (it && it.qty >= cond.x) {
              const free = Math.floor(it.qty / cond.x) * cond.y;
              saved = free * it.unitPrice;
            }
          }
          break;
        case 'COMBO':
          // simplificado, requiere lista de productIds y precio fijo
          if (cond.requiresProductIds && cond.fixedPrice !== undefined) {
            const has = (cond.requiresProductIds as string[]).every((pid) =>
              items.some((i) => i.productId === pid),
            );
            if (has) {
              const sum = (cond.requiresProductIds as string[]).reduce((s, pid) => {
                const it = items.find((i) => i.productId === pid);
                return s + (it ? it.unitPrice : 0);
              }, 0);
              saved = Math.max(0, sum - Number(cond.fixedPrice));
            }
          }
          break;
      }

      if (saved > 0) {
        discount += saved;
        applied.push({
          id: p.id,
          name: p.name,
          type: p.type,
          amountSaved: Number(saved.toFixed(2)),
        });
      }
    }

    // FIX 2026-06-16 (review #6): clamp del descuento total al subtotal.
    // Sin esto, promos apilables podían sumar más que el carrito y, aunque
    // el total se clampea a 0 en orders, dejaba "saved" inconsistente.
    if (discount > subtotal) discount = subtotal;

    return { discount: Number(discount.toFixed(2)), applied };
  }
}
