import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CouponDuration, CouponStatus } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { AuthUser } from '../common/decorators/current-user.decorator';

export type CouponDto = {
  code: string;
  discountPercent: number;
  validFrom?: string | null;
  validUntil?: string | null;
  maxUses?: number | null;
  applicablePlans?: string;
  duration?: CouponDuration;
  status?: CouponStatus;
  referralCodeId?: string | null;
  campaignId?: string | null;
};

export type ResolvedPromo = {
  type: 'coupon' | 'referral' | 'mixed' | 'invalid';
  message: string;
  // Cuando type ≠ invalid:
  discountPercent?: number;
  duration?: CouponDuration;
  attribution?: {
    role: 'INFLUENCER' | 'AMBASSADOR' | 'SOCIO';
    ownerName: string;
    code: string;
  } | null;
  couponId?: string;
  referralCodeId?: string;
};

@Injectable()
export class CouponsService {
  constructor(private prisma: PrismaService) {}

  private assertAdmin(user: AuthUser) {
    if (user.role !== 'SUPER_ADMIN') {
      throw new ForbiddenException('Solo super admin puede gestionar cupones');
    }
  }

  async list(user: AuthUser) {
    this.assertAdmin(user);
    return this.prisma.coupon.findMany({
      include: {
        referralCode: { select: { code: true, ownerName: true, role: true } },
        campaign: { select: { name: true } },
        _count: { select: { uses: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async create(user: AuthUser, dto: CouponDto) {
    this.assertAdmin(user);
    const code = (dto.code ?? '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (code.length < 3 || code.length > 24) {
      throw new BadRequestException('Código entre 3 y 24 caracteres alfanuméricos');
    }
    if (dto.discountPercent <= 0 || dto.discountPercent > 100) {
      throw new BadRequestException('Descuento debe estar entre 1 y 100');
    }
    // No puede chocar con un ReferralCode existente — comparten el espacio
    // de nombres de "código" desde el punto de vista del cliente.
    const dup = await this.prisma.referralCode.findUnique({ where: { code } });
    if (dup) throw new BadRequestException('Ya existe un código de referido con ese nombre');
    return this.prisma.coupon.create({
      data: {
        code,
        discountPercent: dto.discountPercent,
        validFrom: dto.validFrom ? new Date(dto.validFrom) : null,
        validUntil: dto.validUntil ? new Date(dto.validUntil) : null,
        maxUses: dto.maxUses ?? null,
        applicablePlans: dto.applicablePlans ?? '',
        duration: dto.duration ?? 'FIRST_MONTH',
        status: dto.status ?? 'ACTIVE',
        referralCodeId: dto.referralCodeId ?? null,
        campaignId: dto.campaignId ?? null,
      },
    });
  }

  async update(user: AuthUser, id: string, dto: Partial<CouponDto>) {
    this.assertAdmin(user);
    const data: any = { ...dto };
    if ('validFrom' in dto) data.validFrom = dto.validFrom ? new Date(dto.validFrom) : null;
    if ('validUntil' in dto) data.validUntil = dto.validUntil ? new Date(dto.validUntil) : null;
    if ('referralCodeId' in dto) data.referralCodeId = dto.referralCodeId ?? null;
    if ('campaignId' in dto) data.campaignId = dto.campaignId ?? null;
    if ('code' in data) {
      delete data.code; // el código no se edita
    }
    return this.prisma.coupon.update({ where: { id }, data });
  }

  async remove(user: AuthUser, id: string) {
    this.assertAdmin(user);
    await this.prisma.coupon.delete({ where: { id } });
    return { ok: true };
  }

  /**
   * Endpoint público que resuelve un código (puede ser cupón, referral o
   * mixto) y devuelve qué hacer en el checkout. NO falla con 404 — siempre
   * responde 200 con `type: 'invalid'` para que el front muestre el mensaje
   * adecuado sin manejo de errores.
   */
  async resolvePublic(input: { code: string; planName?: string }): Promise<ResolvedPromo> {
    const code = input.code?.trim().toUpperCase();
    if (!code || code.length < 3) {
      return { type: 'invalid', message: 'Ingresa un código' };
    }

    // 1) Cupón
    const coupon = await this.prisma.coupon.findUnique({
      where: { code },
      include: {
        referralCode: {
          select: {
            id: true,
            code: true,
            ownerName: true,
            role: true,
            isActive: true,
          },
        },
      },
    });
    if (coupon) {
      const valid = this.isCouponValid(coupon, input.planName);
      if (!valid.ok) return { type: 'invalid', message: valid.reason };

      const attribution = coupon.referralCode && coupon.referralCode.isActive
        ? {
            role: coupon.referralCode.role as 'INFLUENCER' | 'AMBASSADOR' | 'SOCIO',
            ownerName: coupon.referralCode.ownerName,
            code: coupon.referralCode.code,
          }
        : null;
      return {
        type: attribution ? 'mixed' : 'coupon',
        // Mensaje limpio sin el prefijo "Código aplicado: X" — el cliente
        // ya ve el código que tipeó arriba; mostrar el detalle del
        // beneficio es lo útil. Decisión UI: feedback_no_codigo_aplicado.
        message: `${Number(coupon.discountPercent)}% de descuento${
          coupon.duration === 'RECURRING' ? ' recurrente.' : ' en el primer mes.'
        }${attribution ? ` Esta compra se atribuye a ${attribution.ownerName}.` : ''}`,
        discountPercent: Number(coupon.discountPercent),
        duration: coupon.duration,
        attribution,
        couponId: coupon.id,
        referralCodeId: coupon.referralCodeId ?? undefined,
      };
    }

    // 2) ReferralCode (sin descuento, solo atribución)
    const ref = await this.prisma.referralCode.findUnique({ where: { code } });
    if (ref && ref.isActive) {
      return {
        type: 'referral',
        message: `Esta compra se atribuye a ${ref.ownerName}.`,
        attribution: {
          role: ref.role as 'INFLUENCER' | 'AMBASSADOR' | 'SOCIO',
          ownerName: ref.ownerName,
          code: ref.code,
        },
        referralCodeId: ref.id,
      };
    }

    return {
      type: 'invalid',
      message: 'El código ingresado no es válido o expiró.',
    };
  }

  private isCouponValid(
    c: { status: CouponStatus; validFrom: Date | null; validUntil: Date | null; maxUses: number | null; useCount: number; applicablePlans: string },
    planName?: string,
  ): { ok: true } | { ok: false; reason: string } {
    if (c.status !== 'ACTIVE') return { ok: false, reason: 'El cupón no está activo' };
    const now = Date.now();
    if (c.validFrom && c.validFrom.getTime() > now)
      return { ok: false, reason: 'El cupón aún no es válido' };
    if (c.validUntil && c.validUntil.getTime() < now)
      return { ok: false, reason: 'El cupón expiró' };
    if (c.maxUses && c.useCount >= c.maxUses)
      return { ok: false, reason: 'El cupón alcanzó su límite de usos' };
    if (c.applicablePlans?.trim() && planName) {
      const allowed = c.applicablePlans.split(',').map((s) => s.trim().toLowerCase());
      if (!allowed.includes(planName.toLowerCase())) {
        return { ok: false, reason: `No aplica al plan ${planName}` };
      }
    }
    return { ok: true };
  }

  /**
   * Registra el uso de un cupón al confirmarse el signup. Idempotente:
   * upsert por (couponId, tenantId).
   */
  async registerUse(couponId: string, tenantId: string) {
    const existing = await this.prisma.couponUse.findFirst({
      where: { couponId, tenantId },
    });
    if (existing) return existing;
    const use = await this.prisma.couponUse.create({
      data: { couponId, tenantId },
    });
    await this.prisma.coupon.update({
      where: { id: couponId },
      data: { useCount: { increment: 1 } },
    });
    return use;
  }
}
