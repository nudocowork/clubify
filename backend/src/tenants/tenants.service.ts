import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { TenantStatus } from '@prisma/client';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../common/prisma/prisma.service';
import { AuthService } from '../auth/auth.service';
import { nanoid } from 'nanoid';
import {
  isValidCategorySlug,
  DEFAULT_CATEGORY_SLUG,
} from '../common/business-categories';

export type CreateTenantDto = {
  brandName: string;
  email: string;
  phone?: string;
  planId: string;
  primaryColor?: string;
  secondaryColor?: string;
  ownerFullName: string;
  ownerPassword?: string;
  referredByCode?: string;
  /** Slug de la categoría del rubro (restaurant, barbershop, …). */
  businessCategorySlug?: string;
  /**
   * Si true, crea cuenta gratuita (cortesía) — saltea Hotmart, queda ACTIVE
   * indefinidamente y el lockscreen no se dispara. Útil para internos,
   * partners, beta testers o regalos.
   */
  freeAccount?: boolean;
  /**
   * Días de trial (1-365). Tenant queda en status TRIAL con trialEndsAt en
   * el futuro y se omite el lockscreen (genera código `trial-<id>`).
   * Cuando el trial vence, el cron diario lo suspende.
   */
  trialDays?: number;
  /**
   * ISO date de la próxima fecha de cobro en Hotmart. Si se provee, el
   * tenant arranca ACTIVE con currentPeriodEnd seteado y el lockscreen
   * no bloquea (porque hotmartSubscriberCode también queda no-null).
   */
  nextChargeDate?: string;
  /**
   * Código de suscriptor Hotmart (de su panel). Si admin lo conoce, lo
   * enlaza acá; si no, generamos uno manual `manual-<id>` para que el
   * lockscreen no dispare.
   */
  hotmartSubscriberCode?: string;
};

export type UpdateTenantDto = Partial<{
  brandName: string;
  email: string;
  phone: string;
  logoUrl: string;
  primaryColor: string;
  secondaryColor: string;
  status: TenantStatus;
  planId: string;
  maxLocationsOverride: number | null;
}>;

export type UpdateMyTenantDto = Partial<{
  brandName: string;
  phone: string;
  whatsappPhone: string;
  whatsappOrdersPhone: string;
  whatsappDeliveryPhone: string;
  logoUrl: string;
  primaryColor: string;
  secondaryColor: string;
  instagramUrl: string;
  facebookUrl: string;
  mapsUrl: string;
}>;

@Injectable()
export class TenantsService {
  constructor(
    private prisma: PrismaService,
    private auth: AuthService,
    private jwt: JwtService,
  ) {}

  /**
   * SUPER_ADMIN entra al panel de un tenant como si fuera el dueño.
   * Devuelve un JWT del primer TENANT_OWNER del negocio. El token lleva
   * `impersonatedBy` para que quede constancia en logs si se hace algo
   * destructivo desde la sesión impostada.
   */
  async impersonate(tenantId: string, superAdminId: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true, brandName: true, slug: true, status: true },
    });
    if (!tenant) throw new NotFoundException('Negocio no encontrado');

    const owner = await this.prisma.user.findFirst({
      where: { tenantId, role: 'TENANT_OWNER', isActive: true },
      orderBy: { createdAt: 'asc' },
    });
    if (!owner) {
      throw new BadRequestException(
        'Este negocio no tiene un TENANT_OWNER activo para entrar.',
      );
    }

    const payload = {
      sub: owner.id,
      email: owner.email,
      role: owner.role,
      tenantId: owner.tenantId,
      impersonatedBy: superAdminId,
    };
    const accessToken = this.jwt.sign(payload);

    return {
      accessToken,
      user: {
        id: owner.id,
        email: owner.email,
        fullName: owner.fullName,
        role: owner.role,
        tenantId: owner.tenantId,
      },
      tenant,
    };
  }

  async list() {
    const tenants = await this.prisma.tenant.findMany({
      include: { plan: true, _count: { select: { users: true, cards: true, customers: true } } },
      orderBy: { createdAt: 'desc' },
    });
    if (tenants.length === 0) return [];

    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const orderStats = await this.prisma.order.groupBy({
      by: ['tenantId'],
      where: { createdAt: { gte: since }, status: { not: 'CANCELLED' } },
      _count: { _all: true },
      _sum: { total: true },
    });
    const byTenant = new Map(
      orderStats.map((s) => [s.tenantId, { count: s._count._all, total: Number(s._sum.total ?? 0) }]),
    );

    const now = Date.now();
    return tenants.map((t) => {
      const stat = byTenant.get(t.id) ?? { count: 0, total: 0 };
      const daysLeftInTrial = t.trialEndsAt
        ? Math.max(0, Math.ceil((t.trialEndsAt.getTime() - now) / (24 * 60 * 60 * 1000)))
        : null;
      return {
        ...t,
        orders30: stat.count,
        revenue30: stat.total,
        daysLeftInTrial,
      };
    });
  }

  async getById(id: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id },
      include: { plan: true, locations: true, _count: { select: { cards: true, customers: true, passes: true } } },
    });
    if (!tenant) throw new NotFoundException('Tenant not found');
    return tenant;
  }

  async create(dto: CreateTenantDto) {
    const slug = dto.brandName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '')
      .slice(0, 40) || `tenant-${nanoid(6)}`;

    const exists = await this.prisma.tenant.findUnique({ where: { slug } });
    if (exists) throw new BadRequestException('Slug already exists, pick another brandName');

    const tempPassword = dto.ownerPassword ?? nanoid(12);
    const passwordHash = await this.auth.hashPassword(tempPassword);

    // Determinar billing setup según opciones:
    // 1) freeAccount → ACTIVE indefinido, sin currentPeriodEnd, code 'comp-...'
    // 2) trialDays > 0 → TRIAL con trialEndsAt = now + days, code 'trial-...'
    // 3) nextChargeDate → ACTIVE con currentPeriodEnd y code (provisto o 'manual-...')
    // 4) hotmartSubscriberCode solo → ACTIVE (admin ya verificó pago)
    // 5) ninguno → TRIAL expirado (igual que signup público), lockscreen lo bloquea
    let status: TenantStatus = 'TRIAL';
    let hotmartCode: string | null = null;
    let currentPeriodEnd: Date | null = null;
    let trialEndsAt: Date | null = new Date();
    const trialStartedAt = new Date();

    if (dto.freeAccount) {
      status = 'ACTIVE';
      hotmartCode = `comp-${nanoid(10)}`;
      currentPeriodEnd = null;
      trialEndsAt = null;
    } else if (dto.trialDays && dto.trialDays > 0) {
      const days = Math.min(365, Math.floor(dto.trialDays));
      status = 'TRIAL';
      hotmartCode = `trial-${nanoid(10)}`;
      trialEndsAt = new Date(trialStartedAt.getTime() + days * 24 * 60 * 60 * 1000);
      currentPeriodEnd = null;
    } else if (dto.nextChargeDate) {
      status = 'ACTIVE';
      hotmartCode = dto.hotmartSubscriberCode?.trim() || `manual-${nanoid(10)}`;
      const parsed = new Date(dto.nextChargeDate);
      if (Number.isNaN(parsed.getTime())) {
        throw new BadRequestException('nextChargeDate inválido');
      }
      currentPeriodEnd = parsed;
    } else if (dto.hotmartSubscriberCode) {
      status = 'ACTIVE';
      hotmartCode = dto.hotmartSubscriberCode.trim();
    }

    const categorySlug =
      dto.businessCategorySlug && isValidCategorySlug(dto.businessCategorySlug)
        ? dto.businessCategorySlug
        : DEFAULT_CATEGORY_SLUG;

    const tenant = await this.prisma.tenant.create({
      data: {
        name: dto.brandName,
        brandName: dto.brandName,
        slug,
        email: dto.email,
        phone: dto.phone,
        primaryColor: dto.primaryColor ?? '#0F3D2E',
        secondaryColor: dto.secondaryColor ?? '#2E7D5B',
        businessCategorySlug: categorySlug,
        planId: dto.planId,
        referredByCode: dto.referredByCode,
        status,
        trialStartedAt,
        trialEndsAt,
        currentPeriodEnd,
        hotmartSubscriberCode: hotmartCode,
        users: {
          create: {
            email: dto.email,
            passwordHash,
            fullName: dto.ownerFullName,
            role: 'TENANT_OWNER',
          },
        },
      },
      include: { users: true, plan: true },
    });

    if (dto.referredByCode) {
      const code = await this.prisma.referralCode.findUnique({ where: { code: dto.referredByCode } });
      if (code) {
        await this.prisma.referralUse.create({
          data: { referralCodeId: code.id, tenantId: tenant.id, status: 'SIGNED_UP' },
        });
      }
    }

    return { tenant, ownerTempPassword: dto.ownerPassword ? undefined : tempPassword };
  }

  async update(id: string, dto: UpdateTenantDto) {
    await this.getById(id);
    return this.prisma.tenant.update({ where: { id }, data: dto });
  }

  /**
   * Cambia el modo de facturación de un tenant existente. Mismos modos que
   * en creación (free / trial / paid / pending) pero aplicado sobre tenant
   * existente. Útil para convertir cuentas en cortesía, extender trials de
   * forma arbitraria, marcar pagos manuales o reactivar cuentas suspendidas.
   */
  async updateBilling(
    id: string,
    dto: {
      mode: 'free' | 'trial' | 'paid' | 'pending';
      trialDays?: number;
      nextChargeDate?: string;
      hotmartSubscriberCode?: string;
    },
  ) {
    await this.getById(id);
    const now = new Date();
    let data: any = {};
    switch (dto.mode) {
      case 'free':
        data = {
          status: 'ACTIVE',
          hotmartSubscriberCode: `comp-${nanoid(10)}`,
          trialEndsAt: null,
          currentPeriodEnd: null,
          suspendedAt: null,
        };
        break;
      case 'trial': {
        const days = Math.max(1, Math.min(365, Math.floor(dto.trialDays ?? 7)));
        data = {
          status: 'TRIAL',
          hotmartSubscriberCode: `trial-${nanoid(10)}`,
          trialStartedAt: now,
          trialEndsAt: new Date(now.getTime() + days * 24 * 60 * 60 * 1000),
          currentPeriodEnd: null,
          suspendedAt: null,
        };
        break;
      }
      case 'paid': {
        if (!dto.nextChargeDate && !dto.hotmartSubscriberCode) {
          throw new BadRequestException(
            'Modo "paid" requiere nextChargeDate o hotmartSubscriberCode',
          );
        }
        data = {
          status: 'ACTIVE',
          hotmartSubscriberCode:
            dto.hotmartSubscriberCode?.trim() || `manual-${nanoid(10)}`,
          suspendedAt: null,
        };
        if (dto.nextChargeDate) {
          const parsed = new Date(dto.nextChargeDate);
          if (Number.isNaN(parsed.getTime())) {
            throw new BadRequestException('nextChargeDate inválido');
          }
          data.currentPeriodEnd = parsed;
        }
        break;
      }
      case 'pending':
        data = {
          status: 'TRIAL',
          hotmartSubscriberCode: null,
          trialEndsAt: null,
          currentPeriodEnd: null,
        };
        break;
    }
    return this.prisma.tenant.update({ where: { id }, data });
  }

  async remove(id: string) {
    await this.getById(id);
    await this.prisma.tenant.delete({ where: { id } });
    return { ok: true };
  }

  async setStatus(id: string, status: TenantStatus) {
    const data: any = { status };
    if (status === 'ACTIVE') data.suspendedAt = null;
    if (status === 'SUSPENDED') data.suspendedAt = new Date();
    return this.prisma.tenant.update({ where: { id }, data });
  }

  /** Extiende el trial agregando `days` al trialEndsAt actual (o desde hoy si no hay). */
  async extendTrial(id: string, days: number) {
    const t = await this.prisma.tenant.findUnique({ where: { id } });
    if (!t) throw new NotFoundException('Tenant');
    const base = t.trialEndsAt && t.trialEndsAt.getTime() > Date.now() ? t.trialEndsAt : new Date();
    const newEnd = new Date(base.getTime() + days * 24 * 60 * 60 * 1000);
    return this.prisma.tenant.update({
      where: { id },
      data: {
        trialEndsAt: newEnd,
        status: 'TRIAL',
        suspendedAt: null,
      },
    });
  }

  async getMaxLocations(tenantId: string) {
    const t = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      include: { plan: true },
    });
    if (!t) throw new NotFoundException('Tenant');
    return t.maxLocationsOverride ?? t.plan.maxLocations;
  }

  /** Para que el TENANT_OWNER edite su propia info sin ser super admin. */
  async getMine(tenantId: string) {
    const t = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      include: {
        plan: true,
        _count: { select: { cards: true, customers: true, products: true, locations: true } },
      },
    });
    if (!t) throw new NotFoundException();
    return t;
  }

  async updateMine(tenantId: string, dto: UpdateMyTenantDto) {
    return this.prisma.tenant.update({
      where: { id: tenantId },
      data: dto,
    });
  }
}
