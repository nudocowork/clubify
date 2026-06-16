import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { TenantStatus } from '@prisma/client';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../common/prisma/prisma.service';
import { AuthService } from '../auth/auth.service';
import { AuditService } from '../audit/audit.service';
import { invalidateTenantStatusCache } from '../common/guards/tenant-status.guard';
import { ReferralsService } from '../referrals/referrals.service';
import { QueueService } from '../jobs/queue.service';
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
   * enlaza aquí; si no, generamos uno manual `manual-<id>` para que el
   * lockscreen no dispare.
   */
  hotmartSubscriberCode?: string;
  /**
   * Periodicidad del plan elegida por el admin. Informativo: NO altera
   * billing real (ese lo dicta Hotmart). Sirve para CRM y reporting.
   */
  planPeriodicity?: 'MENSUAL' | 'TRIMESTRAL' | 'SEMESTRAL' | 'ANUAL';
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
  planPeriodicity: 'MENSUAL' | 'TRIMESTRAL' | 'SEMESTRAL' | 'ANUAL' | null;
  // Precio real pagado en Hotmart — base de comisiones. null = limpiar
  // (vuelve al precio canónico del bundle).
  subscriptionPriceUsd: number | null;
  maxLocationsOverride: number | null;
  reviewAlertsAccountId: string | null;
  billingAlertsAccountId: string | null;
  deliveryAlertsAccountId: string | null;
  whatsappPhone: string;
  whatsappOrdersPhone: string;
  whatsappDeliveryPhone: string;
  tutorialsEnabled: boolean;
  academyEnabled: boolean;
}>;

export type UpdateMyTenantDto = Partial<{
  brandName: string;
  phone: string;
  whatsappPhone: string;
  whatsappOrdersPhone: string;
  whatsappDeliveryPhone: string;
  currency: string;
  maxStampsPerDay: number;
  logoUrl: string;
  primaryColor: string;
  secondaryColor: string;
  instagramUrl: string;
  facebookUrl: string;
  mapsUrl: string;
  googleReviewUrl: string;
  walletLogoUrl: string;
  pushLogoUrl: string;
  mainSectionLabelOverride: string | null;
  reviewAlertsEnabled: boolean;
  reviewAlertsThreshold: number;
  reviewAlertsPhone: string | null;
  reviewAlertsTemplate: string | null;
  billingAlertsEnabled: boolean;
  billingAlertsPhone: string | null;
  deliveryAlertsEnabled: boolean;
  deliveryAlertsPhones: string[] | null;
  deliveryAlertsEvents: string[] | null;
  whatsappFeedbackEnabled: boolean;
  whatsappFeedbackNumber: string | null;
  whatsappFeedbackMessage: string | null;
}>;

@Injectable()
export class TenantsService {
  constructor(
    private prisma: PrismaService,
    private auth: AuthService,
    private jwt: JwtService,
    private audit: AuditService,
    @Inject(forwardRef(() => ReferralsService))
    private referrals: ReferralsService,
    private queue: QueueService,
  ) {}

  // Campos del tenant que afectan la APARIENCIA del wallet pass (logo,
  // colores, nombre). Si cambian, hay que re-pushear los passes activos.
  private static WALLET_VISUAL_FIELDS = [
    'logoUrl',
    'walletLogoUrl',
    'pushLogoUrl',
    'primaryColor',
    'secondaryColor',
    'brandName',
  ];

  /**
   * Encola wallet.push para TODOS los passes activos del tenant. Se usa
   * cuando cambia el logo/branding del negocio — antes (bug 2026-06-15) el
   * cambio se guardaba pero el wallet del cliente nunca se refrescaba.
   */
  private async enqueueWalletPushForTenant(tenantId: string) {
    const passes = await this.prisma.pass.findMany({
      where: { tenantId, status: 'ACTIVE' },
      select: { id: true },
    });
    if (passes.length === 0) return;
    // Bump lastActivityAt ANTES del push: el cache-bust del logo de Google
    // (resolveLogoUri ?v=lastActivityAt) lee este valor, así Android
    // re-descarga el logo/branding nuevo. Sin esto el cambio no se reflejaba.
    await this.prisma.pass.updateMany({
      where: { id: { in: passes.map((p) => p.id) } },
      data: { lastActivityAt: new Date() },
    });
    for (const p of passes) {
      await this.queue.enqueue('wallet.push', {
        passId: p.id,
        reason: 'tenant_branding_update',
        // Silent: un cambio de branding NO debe disparar una notificación
        // visible a cada cliente (igual que el refresh global).
        silent: true,
      } as any);
    }
  }

  /**
   * SUPER_ADMIN o MARKETING entran al panel de un tenant como si fueran
   * el dueño. Devuelve un JWT del primer TENANT_OWNER del negocio. El
   * token lleva `impersonatedBy` para que quede constancia en logs si se
   * hace algo destructivo desde la sesión impostada.
   *
   * M5 (2026-06-04): MARKETING también puede impersonar — el rol se usa
   * para implementadores que configuran cuentas de clientes.
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

    // HOTFIX 2026-06-05: dejamos constancia real en AuditLog. Antes el
    // comentario decía "queda constancia en logs" pero NUNCA se llamaba
    // a audit.log → un SUPER_ADMIN/MARKETING podía impersonar tenants
    // sin rastro auditable. Con MARKETING expandido (M5) la superficie
    // creció. Ahora cada inicio de impersonación queda registrado con
    // actor=adminId, tenant=target, action=tenant.impersonate.
    this.audit.log({
      actorId: superAdminId,
      tenantId: tenant.id,
      action: 'tenant.impersonate',
      resource: `tenant:${tenant.id}`,
      metadata: { ownerImpersonated: owner.id, tenantSlug: tenant.slug },
    });

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
      // Bloque 5 (2026-06-12): excluir soft-deleted del listado admin.
      // El SUPER_ADMIN no debería ver tenants eliminados que conservaron
      // historial — la contabilidad sigue por separado vía AuditLog.
      where: { deletedAt: null },
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
        planPeriodicity: dto.planPeriodicity ?? null,
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
    const updated = await this.prisma.tenant.update({
      where: { id },
      data: dto,
    });
    // Mismo refresh de wallet que updateMine: si el admin cambió logo/colores/
    // nombre desde /admin/tenants/[id], re-pusheamos los passes.
    const walletVisualChanged = TenantsService.WALLET_VISUAL_FIELDS.some(
      (k) => k in dto,
    );
    if (walletVisualChanged) {
      this.enqueueWalletPushForTenant(id).catch(() => {});
    }
    return updated;
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
      gracePeriodDays?: number;
      nextChargeDate?: string;
      hotmartSubscriberCode?: string;
    },
    actorId: string,
  ) {
    const previous = await this.getById(id);
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
          // #12 (2026-06-16): activar un negocio elimina el estado Trial.
          // No debe quedar Trial + Activo a la vez. Antes el modo "paid" del
          // simulador dejaba trialEndsAt seteado → banner de trial sobre un
          // negocio ya pago.
          trialEndsAt: null,
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
    if (typeof dto.gracePeriodDays === 'number') {
      data.gracePeriodDays = Math.max(0, Math.min(365, Math.floor(dto.gracePeriodDays)));
    }
    const updated = await this.prisma.tenant.update({ where: { id }, data });
    // Invalidamos el cache del TenantStatusGuard — sino las escrituras de este
    // tenant siguen 402 hasta 30s después del switch a TRIAL/ACTIVE/free.
    invalidateTenantStatusCache(id);
    // Audit 2026-06-08: cambiar billing manualmente puede convertir a
    // un tenant en cortesía (free) o forzar paid sin pago real. Trazable.
    this.audit.log({
      actorId,
      tenantId: id,
      action: 'tenant.billing_updated',
      resource: `tenant:${id}`,
      metadata: {
        brandName: previous.brandName,
        mode: dto.mode,
        previousStatus: previous.status,
        previousPeriodEnd: previous.currentPeriodEnd?.toISOString() ?? null,
        trialDays: dto.trialDays ?? null,
        gracePeriodDays: dto.gracePeriodDays ?? null,
      },
    });
    return updated;
  }

  /**
   * Eliminar tenant — Bloque 5 (2026-06-12). 2 modos:
   *
   *  - keepHistory=true (default seguro): soft-delete. UPDATE deletedAt,
   *    status='SUSPENDED', renombrar email para liberar el UNIQUE
   *    constraint. Las relaciones (Order/Commission/ReferralUse) se
   *    preservan → la contabilidad histórica del afiliado/embajador
   *    sigue trazable, las comisiones PAID se mantienen.
   *
   *  - keepHistory=false: hard-delete con cascade (comportamiento
   *    legacy). Borra TODO: customers, cards, orders, commissions,
   *    referral uses, etc. Solo elegir esto si la cuenta no tiene
   *    actividad crítica (ej. duplicado accidental).
   *
   * Ambos modos disparan AuditLog con el modo aplicado.
   */
  async remove(
    id: string,
    actorId: string,
    opts: { keepHistory: boolean } = { keepHistory: true },
  ) {
    const t = await this.getById(id);

    if (opts.keepHistory) {
      const now = new Date();
      // Renombrar email para liberar UNIQUE — formato deterministic con
      // id corto para que un futuro admin pueda revertir manualmente
      // identificando cuál tenant era.
      const tombstoneEmail = `deleted-${id.slice(0, 8)}@deleted.local`;
      // Soft-delete atómico: tenant + users del tenant inactivos en una
      // sola transacción para que login no quede inconsistente.
      await this.prisma.$transaction([
        this.prisma.tenant.update({
          where: { id },
          data: {
            deletedAt: now,
            status: 'SUSPENDED',
            suspendedAt: now,
            email: tombstoneEmail,
          },
        }),
        // Desactivar usuarios del tenant para que ninguno pueda loguear.
        // No los borramos — su AuditLog histórico (actorId) sigue resoluble.
        this.prisma.user.updateMany({
          where: { tenantId: id, isActive: true },
          data: { isActive: false },
        }),
      ]);
      this.audit.log({
        actorId,
        tenantId: id,
        action: 'tenant.soft_deleted',
        resource: `tenant:${id}`,
        metadata: {
          brandName: t.brandName,
          slug: t.slug,
          email: t.email,
          status: t.status,
          tombstoneEmail,
          mode: 'keep_history',
        },
      });
      invalidateTenantStatusCache(id);
      return { ok: true, mode: 'soft' as const };
    }

    // Hard delete: comportamiento legacy (cascade).
    await this.prisma.tenant.delete({ where: { id } });
    this.audit.log({
      actorId,
      tenantId: id,
      action: 'tenant.deleted',
      resource: `tenant:${id}`,
      metadata: {
        brandName: t.brandName,
        slug: t.slug,
        email: t.email,
        status: t.status,
        mode: 'hard',
      },
    });
    return { ok: true, mode: 'hard' as const };
  }

  async setStatus(id: string, status: TenantStatus, actorId: string) {
    const previous = await this.prisma.tenant.findUnique({
      where: { id },
      select: { status: true, brandName: true, suspendedAt: true },
    });
    if (!previous) throw new NotFoundException('Tenant');
    const data: any = { status };
    if (status === 'ACTIVE') data.suspendedAt = null;
    if (status === 'SUSPENDED') data.suspendedAt = new Date();
    const updated = await this.prisma.tenant.update({ where: { id }, data });
    invalidateTenantStatusCache(id);
    // Audit 2026-06-08: cambio de status manual del super admin.
    this.audit.log({
      actorId,
      tenantId: id,
      action: 'tenant.status_changed',
      resource: `tenant:${id}`,
      metadata: {
        brandName: previous.brandName,
        from: previous.status,
        to: status,
      },
    });
    return updated;
  }

  /**
   * Convierte un tenant en TRIAL (o ACTIVE sin currentPeriodEnd) a
   * cliente pagante: setea currentPeriodEnd a 30 días desde ahora,
   * limpia trialEndsAt, marca status ACTIVE. Si tiene asignación a
   * INFLUENCER/AMBASSADOR, dispara el backfill de comisión.
   *
   * Útil cuando el cliente paga por fuera de Hotmart (transferencia,
   * efectivo) y el admin quiere convertirlo manualmente para que el
   * afiliado vea su comisión.
   */
  async convertToPaying(id: string, actorId: string, periodDays = 30) {
    const t = await this.prisma.tenant.findUnique({ where: { id } });
    if (!t) throw new NotFoundException('Tenant');
    const now = new Date();
    const newPeriodEnd = new Date(
      now.getTime() + periodDays * 24 * 60 * 60 * 1000,
    );
    const updated = await this.prisma.tenant.update({
      where: { id },
      data: {
        status: 'ACTIVE',
        suspendedAt: null,
        trialEndsAt: null,
        currentPeriodEnd: newPeriodEnd,
        // Resetear contador de fallos al convertir manual (asumimos que
        // el pago manual reseta cualquier fallo previo).
        failedPaymentCount: 0,
      },
    });
    invalidateTenantStatusCache(id);

    // Audit 2026-06-08: dispara backfill de comisión al afiliado. Sin
    // este log un super admin podría convertir tenants para inflar
    // comisiones de afiliados sin trazabilidad.
    this.audit.log({
      actorId,
      tenantId: id,
      action: 'tenant.converted_to_paying',
      resource: `tenant:${id}`,
      metadata: {
        brandName: t.brandName,
        previousStatus: t.status,
        previousPeriodEnd: t.currentPeriodEnd?.toISOString() ?? null,
        newPeriodEnd: newPeriodEnd.toISOString(),
        periodDays,
      },
    });

    // Disparar backfill de comisión si tiene asignación de afiliado.
    // Fire-and-forget: si falla, no bloqueamos la conversión — el admin
    // puede usar "Generar comisión ahora" manualmente.
    this.referrals
      .backfillCommissionForCurrentAssignment(id, false)
      .catch(() => null);

    return updated;
  }

  /**
   * Cambia la periodicidad del plan (Mensual/Trimestral/Semestral/Anual)
   * desde /admin/tenants/[id]. Actualiza:
   *   - Tenant.planPeriodicity
   *   - Tenant.currentPeriodEnd = now + meses equivalentes
   *
   * NO toca Hotmart — el admin debe cancelar la suscripción vieja y
   * enviarle al cliente el link del plan nuevo manualmente. Sin esto, el
   * cobro real sigue siendo el del plan anterior. Queda registrado en
   * AuditLog con from/to para trazabilidad.
   */
  async changePlanPeriod(
    id: string,
    periodicity: 'MENSUAL' | 'TRIMESTRAL' | 'SEMESTRAL' | 'ANUAL',
    actorId: string,
  ) {
    const t = await this.prisma.tenant.findUnique({
      where: { id },
      select: {
        id: true,
        planPeriodicity: true,
        currentPeriodEnd: true,
        brandName: true,
      },
    });
    if (!t) throw new NotFoundException('Tenant not found');

    // Meses equivalentes por cada periodicidad — usado para extender
    // currentPeriodEnd desde hoy. NO se toca el status (sigue ACTIVE) ni
    // el failedPaymentCount (esos los maneja Hotmart real).
    const MONTHS_BY_PERIOD: Record<typeof periodicity, number> = {
      MENSUAL: 1,
      TRIMESTRAL: 3,
      SEMESTRAL: 6,
      ANUAL: 12,
    };
    const months = MONTHS_BY_PERIOD[periodicity];
    const now = new Date();
    const newPeriodEnd = new Date(now);
    newPeriodEnd.setMonth(newPeriodEnd.getMonth() + months);

    const updated = await this.prisma.tenant.update({
      where: { id },
      data: {
        planPeriodicity: periodicity,
        currentPeriodEnd: newPeriodEnd,
      },
    });

    // Audit log — deja constancia de from/to para trazabilidad CRM.
    this.audit.log({
      actorId,
      tenantId: id,
      action: 'tenant.plan_period_changed',
      resource: `tenant:${id}`,
      metadata: {
        from: t.planPeriodicity ?? null,
        to: periodicity,
        previousPeriodEnd: t.currentPeriodEnd?.toISOString() ?? null,
        newPeriodEnd: newPeriodEnd.toISOString(),
        brandName: t.brandName,
        note:
          'METADATA INTERNA ONLY — Hotmart no recibe este cambio. El admin debe cancelar la suscripción vieja y enviarle al cliente el link del nuevo plan manualmente.',
      },
    });

    invalidateTenantStatusCache(id);
    return updated;
  }

  /** Extiende el trial agregando `days` al trialEndsAt actual (o desde hoy si no hay). */
  async extendTrial(id: string, days: number, actorId: string) {
    const t = await this.prisma.tenant.findUnique({ where: { id } });
    if (!t) throw new NotFoundException('Tenant');
    const base = t.trialEndsAt && t.trialEndsAt.getTime() > Date.now() ? t.trialEndsAt : new Date();
    const newEnd = new Date(base.getTime() + days * 24 * 60 * 60 * 1000);
    const updated = await this.prisma.tenant.update({
      where: { id },
      data: {
        trialEndsAt: newEnd,
        status: 'TRIAL',
        suspendedAt: null,
      },
    });
    invalidateTenantStatusCache(id);
    // Audit 2026-06-08: dejar rastro de quién extendió y cuánto. El
    // endpoint nuevo /adjust-trial ya audita; éste (extend-trial) era
    // silencioso aunque también modificaba trial y status.
    this.audit.log({
      actorId,
      tenantId: id,
      action: 'tenant.trial_extended',
      resource: `tenant:${id}`,
      metadata: {
        brandName: t.brandName,
        days,
        previousTrialEndsAt: t.trialEndsAt?.toISOString() ?? null,
        newTrialEndsAt: newEnd.toISOString(),
        previousStatus: t.status,
      },
    });
    return updated;
  }

  /**
   * Ajuste fino de trial desde SuperAdmin → modal "Gestionar Trial"
   * (2026-06-07). A diferencia de `extendTrial`, este método:
   *
   *  - acepta `days` positivos o negativos (sumar/descontar);
   *  - si el trial actual ya expiró, parte desde HOY (no desde fecha vieja);
   *  - si el resultado queda ≤ ahora, marca el tenant como SUSPENDED;
   *  - si el resultado queda > ahora, marca como TRIAL (reactiva expirados);
   *  - registra cada cambio en AuditLog con action 'tenant.trial_adjusted'
   *    para que /admin/tenants/[id] muestre el historial.
   *
   * No usamos `convertToPaying` porque acá NO disparamos backfill de
   * comisión (no es un pago real). Solo movemos el reloj.
   */
  async adjustTrial(
    id: string,
    opts: { days: number; observation?: string | null; actorId: string },
  ) {
    const days = Number(opts.days);
    if (!Number.isFinite(days) || days === 0) {
      throw new BadRequestException('days debe ser un número distinto de 0');
    }
    if (Math.abs(days) > 3650) {
      throw new BadRequestException('days fuera de rango (±3650 max)');
    }

    const t = await this.prisma.tenant.findUnique({ where: { id } });
    if (!t) throw new NotFoundException('Tenant');

    // Guard 2026-06-08: si el tenant es cliente pagante (status=ACTIVE
    // con currentPeriodEnd futuro), NUNCA degradarlo a TRIAL ni
    // SUSPENDED. El modal de "Gestionar Trial" se abre desde el listado
    // sin contexto del billing real — un click descuidado +30d podría
    // regresar un cliente Hotmart pagante a status TRIAL y romper la
    // facturación. El SUPER_ADMIN debe usar /admin/tenants/[id] →
    // Billing card para tenants pagantes.
    if (
      t.status === 'ACTIVE' &&
      t.currentPeriodEnd &&
      t.currentPeriodEnd.getTime() > Date.now()
    ) {
      throw new BadRequestException(
        'Este negocio es cliente pagante (suscripción activa). ' +
          'Modificar el trial podría romper su facturación. ' +
          'Usa el panel del tenant para gestionar billing.',
      );
    }

    const now = new Date();
    const previousEnd = t.trialEndsAt;
    // Base = trialEndsAt si está en el futuro, sino HOY. Sumar a una fecha
    // vieja daría una "extensión" engañosa (ej: tenant con trial vencido
    // hace 30d + 5d = -25d → no reactiva). Partir de HOY garantiza que
    // un valor positivo siempre da días reales por delante.
    const base =
      previousEnd && previousEnd.getTime() > now.getTime()
        ? previousEnd
        : now;
    const newEnd = new Date(base.getTime() + days * 24 * 60 * 60 * 1000);

    // Si descontamos hasta el pasado, suspendemos. Si extendemos al
    // futuro, vuelve a TRIAL (reactiva expirados). El guard de arriba
    // ya excluyó ACTIVE pagante, así que acá solo procesamos TRIAL
    // y SUSPENDED.
    const newStatus = newEnd.getTime() <= now.getTime() ? 'SUSPENDED' : 'TRIAL';

    const updated = await this.prisma.tenant.update({
      where: { id },
      data: {
        trialEndsAt: newEnd,
        status: newStatus,
        suspendedAt: newStatus === 'SUSPENDED' ? now : null,
      },
    });

    this.audit.log({
      actorId: opts.actorId,
      tenantId: id,
      action: 'tenant.trial_adjusted',
      resource: `tenant:${id}`,
      metadata: {
        brandName: t.brandName,
        daysDelta: days,
        previousTrialEndsAt: previousEnd?.toISOString() ?? null,
        newTrialEndsAt: newEnd.toISOString(),
        previousStatus: t.status,
        newStatus,
        observation: opts.observation?.trim() || null,
      },
    });

    invalidateTenantStatusCache(id);
    return updated;
  }

  /**
   * Lista los movimientos de trial (audit log filtrado por action
   * 'tenant.trial_adjusted') del tenant, más recientes primero. Incluye
   * el actor (super admin que lo modificó) para la columna "Usuario"
   * del historial.
   */
  async listTrialHistory(tenantId: string, limit = 100) {
    const safeLimit = Math.max(1, Math.min(500, Math.floor(limit)));
    const rows = await this.prisma.auditLog.findMany({
      where: { tenantId, action: 'tenant.trial_adjusted' },
      orderBy: { createdAt: 'desc' },
      take: safeLimit,
      include: {
        actor: { select: { id: true, fullName: true, email: true } },
      },
    });
    return rows.map((r) => ({
      id: r.id,
      createdAt: r.createdAt,
      actor: r.actor
        ? { id: r.actor.id, fullName: r.actor.fullName, email: r.actor.email }
        : null,
      metadata: r.metadata,
    }));
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
        whiteLabel: { select: { creditsUnlimited: true } },
        _count: { select: { cards: true, customers: true, products: true, locations: true } },
      },
    });
    if (!t) throw new NotFoundException();
    // Exponemos un flag plano para el frontend; el lockscreen de Hotmart
    // se salta para tenants bajo marcas blancas con créditos ilimitados.
    return {
      ...t,
      whiteLabelCreditsUnlimited: t.whiteLabel?.creditsUnlimited ?? false,
    };
  }

  async updateMine(tenantId: string, dto: UpdateMyTenantDto) {
    const data: any = { ...dto };
    if ('mainSectionLabelOverride' in data) {
      const raw = data.mainSectionLabelOverride;
      // "" o null limpia el override; texto custom se trimea y se acota a 24 chars.
      data.mainSectionLabelOverride =
        typeof raw === 'string' && raw.trim().length > 0
          ? raw.trim().slice(0, 24)
          : null;
    }
    const updated = await this.prisma.tenant.update({
      where: { id: tenantId },
      data,
    });

    // Si cambió el logo / colores / nombre, re-pusheamos los passes para que
    // el wallet del cliente refleje el cambio (Apple APNs + Google PATCH).
    const walletVisualChanged = TenantsService.WALLET_VISUAL_FIELDS.some(
      (k) => k in dto,
    );
    if (walletVisualChanged) {
      this.enqueueWalletPushForTenant(tenantId).catch(() => {
        /* el push es best-effort; no rompe el guardado del branding */
      });
    }

    return updated;
  }

  /**
   * Toggle del demo lock — solo super admin. Cuando isLocked=true,
   * TenantLockGuard bloquea POST/PATCH/PUT/DELETE de todos los usuarios
   * no-SUPER_ADMIN. Pensado para cuentas demo curadas que los embajadores
   * muestran a prospects sin poder modificar el contenido.
   */
  async setLock(
    tenantId: string,
    opts: { locked: boolean; reason?: string | null; actorId: string },
  ) {
    const t = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true, isLocked: true, brandName: true },
    });
    if (!t) throw new NotFoundException('Negocio no encontrado');
    const updated = await this.prisma.tenant.update({
      where: { id: tenantId },
      data: {
        isLocked: opts.locked,
        lockedAt: opts.locked ? new Date() : null,
        lockedReason: opts.locked ? (opts.reason ?? null) : null,
      },
      select: { id: true, isLocked: true, lockedAt: true, lockedReason: true },
    });
    // Audit 2026-06-08: el demo lock cambia el comportamiento de TODOS
    // los usuarios del tenant (read-only). Trazable.
    this.audit.log({
      actorId: opts.actorId,
      tenantId,
      action: opts.locked ? 'tenant.locked' : 'tenant.unlocked',
      resource: `tenant:${tenantId}`,
      metadata: {
        brandName: t.brandName,
        wasLocked: t.isLocked,
        nowLocked: opts.locked,
        reason: opts.reason ?? null,
      },
    });
    return updated;
  }
}
