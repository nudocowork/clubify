import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { AuthUser } from '../common/decorators/current-user.decorator';

export type CustomerDto = {
  fullName: string;
  email?: string;
  phone?: string;
  birthday?: string;
  externalId?: string;
  tags?: string[];
  notes?: string;
};

@Injectable()
export class CustomersService {
  constructor(private prisma: PrismaService) {}

  private tenantId(user: AuthUser, override?: string) {
    if (user.role === 'SUPER_ADMIN') {
      if (!override) throw new ForbiddenException('tenantId required');
      return override;
    }
    if (!user.tenantId) throw new ForbiddenException();
    return user.tenantId;
  }

  list(user: AuthUser, search?: string, override?: string) {
    const tid = this.tenantId(user, override);
    return this.prisma.customer.findMany({
      where: {
        tenantId: tid,
        ...(search
          ? {
              OR: [
                { fullName: { contains: search, mode: 'insensitive' } },
                { email: { contains: search, mode: 'insensitive' } },
                { phone: { contains: search } },
              ],
            }
          : {}),
      },
      include: { _count: { select: { passes: true, stamps: true } } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  async get(user: AuthUser, id: string) {
    const c = await this.prisma.customer.findUnique({
      where: { id },
      include: {
        passes: { include: { card: true } },
        stamps: { orderBy: { createdAt: 'desc' }, take: 50 },
      },
    });
    if (!c) throw new NotFoundException('Customer');
    if (user.role !== 'SUPER_ADMIN' && c.tenantId !== user.tenantId) {
      throw new ForbiddenException();
    }
    // Enrich con pedidos recientes (los queries por `customerId` ya tienen índice)
    const orders = await this.prisma.order.findMany({
      where: { customerId: id },
      orderBy: { createdAt: 'desc' },
      take: 30,
      select: {
        id: true,
        code: true,
        status: true,
        total: true,
        paymentStatus: true,
        fulfillment: true,
        createdAt: true,
      },
    });
    return { ...c, orders };
  }

  async create(user: AuthUser, dto: CustomerDto, override?: string) {
    const tid = this.tenantId(user, override);
    try {
      return await this.prisma.customer.create({
        data: {
          tenantId: tid,
          fullName: dto.fullName,
          email: dto.email,
          phone: dto.phone,
          birthday: dto.birthday ? new Date(dto.birthday) : undefined,
          externalId: dto.externalId,
        },
      });
    } catch (e: any) {
      if (e?.code === 'P2002') {
        // Unique tenantId_phone o tenantId_email — el dueño quiso crear
        // un customer que ya existe. Devolvemos 409 con mensaje claro
        // en vez de 500 con stack.
        const target = (e.meta?.target as string[] | string | undefined) ?? '';
        const field =
          Array.isArray(target) ? target.join(',') : String(target);
        const human = field.includes('email')
          ? 'Ya existe un cliente con este email'
          : field.includes('phone')
          ? 'Ya existe un cliente con este teléfono'
          : 'Ya existe un cliente con estos datos';
        throw new ConflictException(human);
      }
      throw e;
    }
  }

  async update(user: AuthUser, id: string, dto: Partial<CustomerDto>) {
    await this.get(user, id);
    try {
      return await this.prisma.customer.update({
        where: { id },
        data: {
          ...dto,
          birthday: dto.birthday ? new Date(dto.birthday) : undefined,
          tags: dto.tags ?? undefined,
        },
      });
    } catch (e: any) {
      if (e?.code === 'P2002') {
        const target = (e.meta?.target as string[] | string | undefined) ?? '';
        const field =
          Array.isArray(target) ? target.join(',') : String(target);
        throw new ConflictException(
          field.includes('email')
            ? 'Otro cliente ya tiene este email'
            : field.includes('phone')
            ? 'Otro cliente ya tiene este teléfono'
            : 'Conflicto con datos existentes',
        );
      }
      throw e;
    }
  }

  async remove(user: AuthUser, id: string) {
    await this.get(user, id);
    await this.prisma.customer.delete({ where: { id } });
    return { ok: true };
  }

  // ============================================================
  //                 DUPLICATE DETECTION + MERGE
  // ============================================================

  private normalizePhone(p?: string | null): string | null {
    if (!p) return null;
    const digits = p.replace(/\D/g, '');
    if (digits.length < 8) return null;
    return digits.slice(-10);
  }

  private normalizeEmail(e?: string | null): string | null {
    if (!e) return null;
    const v = e.trim().toLowerCase();
    return v.length > 3 ? v : null;
  }

  /**
   * Devuelve grupos de clientes que probablemente son la misma persona.
   * Reglas (conservadoras, evita falsos positivos):
   *   - Mismo teléfono normalizado (últimos 10 dígitos) → "phone"
   *   - Mismo email lowercased → "email"
   * Cada grupo trae 2+ customers ordenados por createdAt asc (el más antiguo primero).
   */
  async findDuplicates(user: AuthUser, override?: string) {
    const tid = this.tenantId(user, override);
    const all = await this.prisma.customer.findMany({
      where: { tenantId: tid },
      select: {
        id: true,
        fullName: true,
        email: true,
        phone: true,
        createdAt: true,
        totalOrdersCount: true,
        totalOrdersAmount: true,
        lastOrderAt: true,
        _count: { select: { passes: true, stamps: true, orders: true } },
      },
      orderBy: { createdAt: 'asc' },
    });

    type C = (typeof all)[number];
    const byPhone = new Map<string, C[]>();
    const byEmail = new Map<string, C[]>();

    for (const c of all) {
      const ph = this.normalizePhone(c.phone);
      const em = this.normalizeEmail(c.email);
      if (ph) {
        const arr = byPhone.get(ph) ?? [];
        arr.push(c);
        byPhone.set(ph, arr);
      }
      if (em) {
        const arr = byEmail.get(em) ?? [];
        arr.push(c);
        byEmail.set(em, arr);
      }
    }

    const groups: Array<{
      reason: 'phone' | 'email';
      key: string;
      customers: C[];
    }> = [];
    const seen = new Set<string>();
    const groupKey = (reason: string, ids: string[]) =>
      `${reason}:${[...ids].sort().join(',')}`;

    for (const [key, arr] of byPhone) {
      if (arr.length < 2) continue;
      const k = groupKey('phone', arr.map((c) => c.id));
      if (seen.has(k)) continue;
      seen.add(k);
      groups.push({ reason: 'phone', key, customers: arr });
    }
    for (const [key, arr] of byEmail) {
      if (arr.length < 2) continue;
      const k = groupKey('email', arr.map((c) => c.id));
      if (seen.has(k)) continue;
      seen.add(k);
      groups.push({ reason: 'email', key, customers: arr });
    }

    return {
      total: groups.length,
      groups,
    };
  }

  /**
   * Fusiona N clientes en uno (`keepId`). Reasigna passes/stamps/orders/carts/
   * messages/eventos/redenciones, suma stamps cuando hay pase del mismo card en
   * ambos lados, libera los uniques (email/phone) del que se va antes de borrar,
   * y recalcula los totales del que se conserva.
   */
  async merge(user: AuthUser, keepId: string, mergeIds: string[]) {
    if (!mergeIds?.length) {
      throw new ForbiddenException('mergeIds vacío');
    }
    if (mergeIds.includes(keepId)) {
      throw new ForbiddenException('keepId no puede estar en mergeIds');
    }
    const keeper = await this.get(user, keepId);
    const tid = keeper.tenantId;

    const merging = await this.prisma.customer.findMany({
      where: { id: { in: mergeIds }, tenantId: tid },
    });
    if (merging.length !== mergeIds.length) {
      throw new NotFoundException('Algún cliente no existe en este tenant');
    }

    const result = await this.prisma.$transaction(async (tx) => {
      let movedOrders = 0;
      let movedStamps = 0;
      let mergedPasses = 0;
      let movedPasses = 0;

      for (const src of merging) {
        // 1) Pases — manejar conflicto unique (cardId, customerId)
        const srcPasses = await tx.pass.findMany({
          where: { customerId: src.id },
        });
        for (const sp of srcPasses) {
          const dup = await tx.pass.findUnique({
            where: {
              cardId_customerId: { cardId: sp.cardId, customerId: keepId },
            },
          });
          if (dup) {
            // Sumar stamps y puntos al pass del keeper, mover stamps históricos, borrar el pass src
            await tx.pass.update({
              where: { id: dup.id },
              data: {
                stampsCount: dup.stampsCount + sp.stampsCount,
                pointsBalance: Number(dup.pointsBalance) + Number(sp.pointsBalance),
              },
            });
            await tx.stamp.updateMany({
              where: { passId: sp.id },
              data: { passId: dup.id, customerId: keepId },
            });
            await tx.pass.delete({ where: { id: sp.id } });
            mergedPasses += 1;
          } else {
            await tx.pass.update({
              where: { id: sp.id },
              data: { customerId: keepId },
            });
            movedPasses += 1;
          }
        }

        // 2) Stamps que NO pasaron por el merge de pases (caso edge: stamp sin pass)
        const remainingStamps = await tx.stamp.updateMany({
          where: { customerId: src.id },
          data: { customerId: keepId },
        });
        movedStamps += remainingStamps.count;

        // 3) Orders + carts + messages + redenciones + eventos
        const ord = await tx.order.updateMany({
          where: { customerId: src.id },
          data: { customerId: keepId },
        });
        movedOrders += ord.count;
        await tx.cart.updateMany({
          where: { customerId: src.id },
          data: { customerId: keepId },
        });
        await tx.message.updateMany({
          where: { customerId: src.id },
          data: { customerId: keepId },
        });
        // PromotionRedemption + Event tienen customerId como columna pero sin
        // relación Prisma — actualizamos por SQL directo.
        await tx.$executeRawUnsafe(
          `UPDATE "PromotionRedemption" SET "customerId" = $1 WHERE "customerId" = $2`,
          keepId,
          src.id,
        );
        await tx.$executeRawUnsafe(
          `UPDATE "Event" SET "customerId" = $1 WHERE "customerId" = $2`,
          keepId,
          src.id,
        );

        // 4) Limpiar contacto del src para liberar uniques antes del delete
        // (delete cascadea solo donde el FK tiene onDelete: Cascade — passes/stamps —
        //  pero ya los movimos, así que el delete debe ser limpio)
        await tx.customer.update({
          where: { id: src.id },
          data: { email: null, phone: null },
        });
        await tx.customer.delete({ where: { id: src.id } });
      }

      // 5) Mergear metadata en el keeper: tags (union), notes (concat),
      //    completar email/phone/birthday si están vacíos en keeper
      const allTags = new Set<string>(keeper.tags ?? []);
      const noteParts: string[] = [];
      if (keeper.notes) noteParts.push(keeper.notes);
      let fillEmail: string | undefined;
      let fillPhone: string | undefined;
      let fillBirthday: Date | undefined;

      for (const src of merging) {
        for (const t of src.tags ?? []) allTags.add(t);
        if (src.notes) {
          noteParts.push(`— Fusionado de ${src.fullName}: ${src.notes}`);
        }
        if (!keeper.email && !fillEmail && src.email) fillEmail = src.email;
        if (!keeper.phone && !fillPhone && src.phone) fillPhone = src.phone;
        if (!keeper.birthday && !fillBirthday && src.birthday) {
          fillBirthday = src.birthday;
        }
      }

      // 6) Recalcular totales reales del keeper desde sus orders
      const ordersAgg = await tx.order.aggregate({
        where: { customerId: keepId },
        _count: { _all: true },
        _sum: { total: true },
        _min: { createdAt: true },
        _max: { createdAt: true },
      });

      const updated = await tx.customer.update({
        where: { id: keepId },
        data: {
          email: fillEmail ?? keeper.email,
          phone: fillPhone ?? keeper.phone,
          birthday: fillBirthday ?? keeper.birthday ?? undefined,
          tags: Array.from(allTags),
          notes: noteParts.length ? noteParts.join('\n\n') : keeper.notes,
          totalOrdersCount: ordersAgg._count._all,
          totalOrdersAmount: ordersAgg._sum.total ?? 0,
          firstOrderAt: ordersAgg._min.createdAt ?? keeper.firstOrderAt ?? null,
          lastOrderAt: ordersAgg._max.createdAt ?? keeper.lastOrderAt ?? null,
        },
      });

      return {
        ok: true,
        keepId,
        mergedCount: merging.length,
        movedOrders,
        movedStamps,
        movedPasses,
        mergedPasses,
        keeper: updated,
      };
    });

    return result;
  }

  /**
   * Importa clientes desde un array (parseado del CSV en frontend).
   * - Si el cliente ya existe (mismo phone o email en el tenant) lo actualiza.
   * - Devuelve totales para mostrar al usuario.
   */
  async bulkImport(
    user: AuthUser,
    rows: Array<{
      fullName: string;
      email?: string;
      phone?: string;
      birthday?: string;
      tags?: string;
    }>,
    override?: string,
  ) {
    const tid = this.tenantId(user, override);
    let created = 0;
    let updated = 0;
    let skipped = 0;
    const errors: string[] = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      try {
        if (!row.fullName?.trim()) {
          skipped += 1;
          continue;
        }
        const phone = row.phone?.trim() || undefined;
        const email = row.email?.trim().toLowerCase() || undefined;

        let existing: { id: string } | null = null;
        if (phone) {
          existing = await this.prisma.customer.findUnique({
            where: { tenantId_phone: { tenantId: tid, phone } },
            select: { id: true },
          });
        }
        if (!existing && email) {
          existing = await this.prisma.customer.findUnique({
            where: { tenantId_email: { tenantId: tid, email } },
            select: { id: true },
          });
        }

        const data = {
          fullName: row.fullName.trim(),
          email,
          phone,
          birthday: row.birthday ? new Date(row.birthday) : undefined,
          tags: row.tags
            ? row.tags
                .split(',')
                .map((t) => t.trim())
                .filter(Boolean)
            : undefined,
        };

        if (existing) {
          await this.prisma.customer.update({
            where: { id: existing.id },
            data,
          });
          updated += 1;
        } else {
          await this.prisma.customer.create({
            data: { tenantId: tid, ...data },
          });
          created += 1;
        }
      } catch (e: any) {
        errors.push(`Fila ${i + 1}: ${e.message ?? 'error'}`);
      }
    }

    return {
      total: rows.length,
      created,
      updated,
      skipped,
      errors: errors.slice(0, 10),
    };
  }
}
