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
import { addPlanPeriod } from '../common/plan-period';
import { AuthUser } from '../common/decorators/current-user.decorator';
import { QueueService } from '../jobs/queue.service';
import { GrowBusinessService } from '../integrations/grow-business.service';
import { nanoid } from 'nanoid';
import {
  isValidCategorySlug,
  DEFAULT_CATEGORY_SLUG,
} from '../common/business-categories';

export type CreateTenantDto = {
  brandName: string;
  email: string;
  phone?: string;
  /** #9: opcional. Si no viene, se usa el plan "Sin plan" (precio 0), que
   *  permite crear el negocio aunque la marca aún no tenga planes. */
  planId?: string;
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
  // Modo de reparto de comisión del vendedor (Fase 3 overhaul comisiones).
  commissionDistributionMode:
    | 'DISCOUNT_FROM_INFLUENCER'
    | 'ADDITIONAL_COMPANY_COMMISSION';
  // Precio real pagado en Hotmart — base de comisiones. null = limpiar
  // (vuelve al precio canónico del bundle).
  subscriptionPriceUsd: number | null;
  maxLocationsOverride: number | null;
  reviewAlertsAccountId: string | null;
  billingAlertsAccountId: string | null;
  deliveryAlertsAccountId: string | null;
  // #14 (2026-06-17): config de alertas SMS de domicilio movida de
  // /app/settings (vista cliente) a super-admin /admin/tenants/[id].
  deliveryAlertsEnabled: boolean;
  deliveryAlertsPhones: string[] | null;
  deliveryAlertsEvents: string[] | null;
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
    private growBusiness: GrowBusinessService,
  ) {}

  /**
   * #14 (2026-06-17): test del SMS de alerta de domicilio para un tenant dado.
   * Lo usa el super-admin desde /admin/tenants/[id] (la config se movió de la
   * vista del dueño). Resuelve creds (subcuenta global > creds tenant) y manda
   * un SMS de prueba a los teléfonos configurados.
   */
  async sendDeliveryAlertTest(tenantId: string) {
    const tenant = await this.prisma.tenant.findFirst({
      where: { id: tenantId }, // aislado por marca (middleware)
      select: {
        brandName: true,
        whatsappDeliveryPhone: true,
        deliveryAlertsPhones: true,
        deliveryAlertsAccountId: true,
        growBusinessLocationId: true,
        growBusinessApiKey: true,
        growBusinessSwitchNumber: true,
      },
    });
    if (!tenant) throw new NotFoundException('Negocio no encontrado');

    const phones: string[] = Array.isArray(tenant.deliveryAlertsPhones)
      ? (tenant.deliveryAlertsPhones as string[]).filter(
          (p) => typeof p === 'string' && p.trim().length >= 6,
        )
      : [];
    if (phones.length === 0 && tenant.whatsappDeliveryPhone) {
      phones.push(tenant.whatsappDeliveryPhone);
    }
    if (phones.length === 0) {
      throw new BadRequestException(
        'Sin teléfonos destino — agrega al menos uno antes de probar.',
      );
    }

    let creds: {
      locationId: string;
      apiKey: string;
      switchNumber: number | null;
    } | null = null;
    if (tenant.deliveryAlertsAccountId) {
      const acc = await this.prisma.growBusinessAccount.findFirst({
        where: { id: tenant.deliveryAlertsAccountId, deletedAt: null },
        select: { locationId: true, apiKey: true, switchNumber: true },
      });
      if (acc) {
        creds = {
          locationId: acc.locationId,
          apiKey: acc.apiKey,
          switchNumber: acc.switchNumber,
        };
      }
    }
    if (!creds && tenant.growBusinessLocationId && tenant.growBusinessApiKey) {
      creds = {
        locationId: tenant.growBusinessLocationId,
        apiKey: tenant.growBusinessApiKey,
        switchNumber: tenant.growBusinessSwitchNumber,
      };
    }
    if (!creds) {
      throw new BadRequestException(
        'Sin credenciales — asigna una subcuenta o conecta Grow Business para el negocio.',
      );
    }

    const body =
      '🧪 Test de alerta de domicilio\n\n' +
      `Negocio: ${tenant.brandName}\n` +
      'Si recibiste este SMS, las alertas de pedidos delivery están listas.';
    const results = await Promise.all(
      phones.map(async (p) => {
        const r = await this.growBusiness
          .sendSmsWithCreds(creds!, p, body)
          .catch((e) => ({ ok: false as const, message: e?.message }));
        return {
          phone: p,
          ok: r.ok,
          message: !r.ok ? (r as any).message : null,
        };
      }),
    );
    const okCount = results.filter((r) => r.ok).length;
    return { ok: okCount > 0, total: phones.length, okCount, results };
  }

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
    // Seguridad: findFirst (NO findUnique) → el middleware lo acota a la marca
    // del admin. Un admin de otra marca NO puede impersonar este negocio.
    const tenant = await this.prisma.tenant.findFirst({
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

  /**
   * #11 (2026-06-16): ranking de negocios por cantidad de pases emitidos.
   * Mayor a menor por default; `order='asc'` invierte. Incluye negocios con
   * 0 pases. Excluye borrados.
   */
  async rankingByPasses(order: 'asc' | 'desc' = 'desc') {
    const tenants = await this.prisma.tenant.findMany({
      where: { deletedAt: null },
      select: { id: true, brandName: true, name: true, status: true },
    });
    const grouped = await this.prisma.pass.groupBy({
      by: ['tenantId'],
      _count: { _all: true },
    });
    const countMap = new Map(grouped.map((g) => [g.tenantId, g._count._all]));
    const rows = tenants.map((t) => ({
      id: t.id,
      brandName: t.brandName || t.name,
      status: t.status,
      passCount: countMap.get(t.id) ?? 0,
    }));
    rows.sort((a, b) =>
      order === 'asc' ? a.passCount - b.passCount : b.passCount - a.passCount,
    );
    return rows;
  }

  private _clubifyWlId: string | null | undefined;
  /** Id de la marca 'clubify' (cacheado). El panel /admin sin marca activa
   *  hace default a esta marca (no "ver todo"). */
  private async clubifyWlId(): Promise<string | null> {
    if (this._clubifyWlId !== undefined) return this._clubifyWlId;
    const wl = await this.prisma.whiteLabel.findFirst({
      where: { slug: 'clubify' },
      select: { id: true },
    });
    this._clubifyWlId = wl?.id ?? null;
    return this._clubifyWlId;
  }

  /** WHERE de marca para el panel /admin. Sin marca en sesión → default Clubify
   *  (incluye tenants legacy null). Con marca → estricto a esa marca. Nunca
   *  "ver todo" acá; el cross-brand es /superadmin. */
  private async brandTenantWhere(
    sessionWlId: string | null,
  ): Promise<Record<string, any>> {
    const clubifyId = await this.clubifyWlId();
    const wlId = sessionWlId ?? clubifyId;
    if (!wlId) return {}; // sin marca clubify configurada (dev) → sin filtro
    if (wlId === clubifyId) {
      // Clubify ve sus tenants + los legacy sin marca (whiteLabelId null).
      return { OR: [{ whiteLabelId: clubifyId }, { whiteLabelId: null }] };
    }
    return { whiteLabelId: wlId };
  }

  async list(user?: AuthUser) {
    // Aislamiento por MARCA BLANCA en el panel /admin. Cada admin ve SOLO los
    // negocios de su marca. La vista cross-brand vive en /superadmin (master
    // admin), NO acá. Por eso, si no hay marca en la sesión (null = Clubify/
    // plataforma en el panel /admin), hacemos DEFAULT a la marca Clubify — NO
    // "ver todo". Clubify incluye los tenants legacy con whiteLabelId null.
    const where = await this.brandTenantWhere(user?.whiteLabelId ?? null);
    const tenants = await this.prisma.tenant.findMany({
      // Bloque 5 (2026-06-12): excluir soft-deleted del listado admin.
      where: { deletedAt: null, ...where },
      include: {
        plan: true,
        businessGroup: { select: { id: true, name: true, status: true } },
        _count: { select: { users: true, cards: true, customers: true } },
      },
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
    // Aislamiento por marca: findFirst (NO findUnique) para que el middleware
    // Prisma lo acote a los tenants de la marca activa (modo whiteLabel). Un
    // admin de otra marca que pida un id ajeno recibe NotFound. update()/
    // remove() llaman a getById primero, así que también quedan aislados.
    const tenant = await this.prisma.tenant.findFirst({
      where: { id },
      include: {
        plan: true,
        locations: true,
        _count: { select: { cards: true, customers: true, passes: true } },
        // Módulos de la marca → el detalle gatea secciones (ej. panels de
        // referidos) según lo que la marca tenga habilitado.
        whiteLabel: {
          select: {
            slug: true,
            name: true,
            modules: { where: { enabled: true }, select: { module: true } },
            // Planes de pago de la marca → el modal "Cambiar plan" muestra SOLO
            // las periodicidades/precios de la marca del negocio (no los de
            // Clubify). Sellea = Mensual + Anual con sus precios.
            paymentLinks: {
              where: { active: true },
              orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
              select: { periodicity: true, amountUsd: true, url: true },
            },
          },
        },
      },
    });
    if (!tenant) throw new NotFoundException('Tenant not found');
    // Aplanamos los módulos habilitados a string[] para el frontend.
    const enabledModules = tenant.whiteLabel?.modules?.map((m) => m.module) ?? null;
    // Planes de la marca para el modal de cambio de periodicidad. Vacío para
    // Clubify / marca sin links → el frontend cae a su set de planes Clubify.
    const brandPlans =
      tenant.whiteLabel?.paymentLinks?.map((l) => ({
        periodicity: l.periodicity,
        amountUsd: l.amountUsd != null ? Number(l.amountUsd) : null,
        url: l.url ?? null,
      })) ?? [];
    return { ...tenant, enabledModules, brandPlans };
  }

  /** #9: asegura un Plan "Sin plan" (precio 0) reutilizable para crear
   *  negocios cuando la marca todavía no tiene planes configurados. Idempotente
   *  por nombre único. */
  private async ensureFreePlan() {
    const existing = await this.prisma.plan.findUnique({
      where: { name: 'Sin plan' },
    });
    if (existing) return existing;
    return this.prisma.plan.create({
      data: { name: 'Sin plan', priceMonthly: 0, isActive: true },
    });
  }

  async create(dto: CreateTenantDto, user?: AuthUser) {
    const base = dto.brandName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '')
      .slice(0, 40) || `tenant-${nanoid(6)}`;

    // #3: el MISMO nombre puede existir en marcas blancas distintas (Clubify y
    // Sellea pueden tener cada uno "Mi Restaurante"). El slug se mantiene
    // ÚNICO GLOBAL (las URLs /m/<slug> y subdominios lo exigen), así que si
    // choca, le agregamos un sufijo en vez de rechazar la creación.
    let slug = base;
    for (let n = 2; n <= 99; n++) {
      const exists = await this.prisma.tenant.findUnique({ where: { slug } });
      if (!exists) break;
      slug = `${base.slice(0, 37)}-${n}`;
      if (n === 99) slug = `${base.slice(0, 33)}-${nanoid(6)}`;
    }

    // #9: si no se eligió plan (marca sin planes configurados, ej Sellea),
    // usamos el plan "Sin plan" (precio 0) que se asegura on-demand.
    const planId = dto.planId ?? (await this.ensureFreePlan()).id;

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

    // Marca blanca: la activación de sus negocios se hace con CRÉDITOS, no con
    // los modos Hotmart (que son de Clubify). Un negocio creado por un admin de
    // marca NACE BLOQUEADO (SUSPENDED) y el admin debe asignarle un crédito en
    // el popup obligatorio post-creación (o comprar). Las marcas con créditos
    // ILIMITADOS se activan solas (+30d) sin fricción. Clubify (sin marca) sigue
    // el flujo Hotmart de arriba sin cambios.
    const isBrandAdmin = !!user?.whiteLabelId;
    let brandUnlimited = false;
    if (isBrandAdmin) {
      const wl = await this.prisma.whiteLabel.findUnique({
        where: { id: user!.whiteLabelId! },
        select: { creditsUnlimited: true },
      });
      brandUnlimited = !!wl?.creditsUnlimited;
      if (brandUnlimited) {
        status = 'ACTIVE';
        hotmartCode = `wl-${nanoid(10)}`;
        currentPeriodEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
        trialEndsAt = null;
      } else {
        status = 'SUSPENDED';
        hotmartCode = `wl-${nanoid(10)}`;
        currentPeriodEnd = null;
        trialEndsAt = null;
      }
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
        planId,
        // #2/#6: el negocio hereda la MARCA BLANCA del admin que lo crea, así
        // aparece solo en esa marca y nunca en otra (Sellea→sellea, Clubify→clubify).
        whiteLabelId: user?.whiteLabelId ?? null,
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

    return {
      tenant,
      ownerTempPassword: dto.ownerPassword ? undefined : tempPassword,
      // El front muestra el popup obligatorio de créditos cuando esto es true
      // (negocio creado por marca blanca con créditos no-ilimitados → bloqueado).
      requiresCreditActivation: isBrandAdmin && !brandUnlimited,
    };
  }

  async update(id: string, dto: UpdateTenantDto) {
    const before = await this.getById(id);
    const updated = await this.prisma.tenant.update({
      where: { id },
      // `as any`: deliveryAlertsPhones/Events son columnas Json (string[]|null)
      // y Prisma no acepta el tipo directo. Mismo patrón que updateMine.
      data: dto as any,
    });
    // Si cambió el modo de reparto de comisión, recalculamos las comisiones
    // PENDIENTES/APROBADAS del negocio con el nuevo split (las PAGADAS quedan
    // intactas). Best-effort: un fallo del recalc no rompe el update.
    if (
      dto.commissionDistributionMode !== undefined &&
      dto.commissionDistributionMode !== (before as any).commissionDistributionMode
    ) {
      this.referrals
        .recalcTenantSplit(id, null, 'distribution_mode_change')
        .catch(() => undefined);
    }
    // Si cambió el precio REAL pagado (base de comisiones), recalculamos las
    // comisiones PENDIENTES/APROBADAS sobre la nueva base. Sin esto, poner
    // "$50" guardaba el campo pero la comisión seguía sobre el canónico ($68).
    if (
      dto.subscriptionPriceUsd !== undefined &&
      Number(dto.subscriptionPriceUsd ?? NaN) !==
        Number((before as any).subscriptionPriceUsd ?? NaN)
    ) {
      this.referrals
        .recalcTenantSplit(id, null, 'subscription_price_change')
        .catch(() => undefined);
    }
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
        const proposedEnd = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
        // Tope por créditos de la marca (sin créditos → máx N días o bloqueado).
        const trialEndsAt = await this.clampTrialEnd(previous.whiteLabelId, proposedEnd, now);
        data = {
          status: 'TRIAL',
          hotmartSubscriberCode: `trial-${nanoid(10)}`,
          trialStartedAt: now,
          trialEndsAt,
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
    const previous = await this.prisma.tenant.findFirst({
      where: { id }, // findFirst → aislado por marca (middleware whiteLabel)
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
  async convertToPaying(id: string, actorId: string, periodDays?: number) {
    const t = await this.prisma.tenant.findFirst({ where: { id } }); // aislado por marca (middleware)
    if (!t) throw new NotFoundException('Tenant');
    const now = new Date();
    // Bug #1: por default el periodo se extiende según la periodicidad real
    // del plan (Trimestral = +3 meses). Solo se usa `periodDays` si el caller
    // lo pasa explícito (override puntual).
    const newPeriodEnd =
      periodDays != null
        ? new Date(now.getTime() + periodDays * 24 * 60 * 60 * 1000)
        : addPlanPeriod(now, t.planPeriodicity);
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
    const t = await this.prisma.tenant.findFirst({
      where: { id }, // aislado por marca (middleware)
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
  /** Tope de días de trial para un tenant según los créditos de su marca.
   *  null = sin tope (Clubify, marca con créditos, o ilimitada).
   *  number = máximo de días desde HOY (0 = trials bloqueados). */
  private async trialCapDays(whiteLabelId: string | null): Promise<number | null> {
    if (!whiteLabelId) return null; // Clubify / sin marca
    const wl = await this.prisma.whiteLabel.findUnique({
      where: { id: whiteLabelId },
      select: { creditsUnlimited: true, creditsAvailable: true, slug: true },
    });
    if (!wl || wl.slug === 'clubify' || wl.creditsUnlimited) return null;
    if (wl.creditsAvailable >= 1) return null; // tiene créditos → sin tope
    // Sin créditos → setting platform.maxTrialDaysNoCredits (default 7).
    const s = await this.prisma.setting.findUnique({
      where: { key: 'platform.maxTrialDaysNoCredits' },
    });
    const n = s?.value != null ? Number(s.value) : NaN;
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 7;
  }

  /** Aplica el tope de trial (créditos de la marca) a un trialEnd propuesto.
   *  Lanza si los trials están bloqueados (cap 0). Solo se llama cuando el
   *  resultado deja al tenant en TRIAL (no al suspender). */
  private async clampTrialEnd(
    whiteLabelId: string | null,
    proposedEnd: Date,
    now = new Date(),
  ): Promise<Date> {
    const cap = await this.trialCapDays(whiteLabelId);
    if (cap == null) return proposedEnd;
    if (cap === 0) {
      throw new BadRequestException(
        'La marca no tiene créditos disponibles: no se pueden activar pruebas gratuitas. Recarga créditos para continuar.',
      );
    }
    const maxEnd = new Date(now.getTime() + cap * 24 * 60 * 60 * 1000);
    return proposedEnd.getTime() > maxEnd.getTime() ? maxEnd : proposedEnd;
  }

  async extendTrial(id: string, days: number, actorId: string) {
    const t = await this.prisma.tenant.findFirst({ where: { id } }); // aislado por marca (middleware)
    if (!t) throw new NotFoundException('Tenant');
    const base = t.trialEndsAt && t.trialEndsAt.getTime() > Date.now() ? t.trialEndsAt : new Date();
    const proposedEnd = new Date(base.getTime() + days * 24 * 60 * 60 * 1000);
    // Tope por créditos de la marca (sin créditos → máx N días o bloqueado).
    const newEnd = await this.clampTrialEnd(t.whiteLabelId, proposedEnd);
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

    const t = await this.prisma.tenant.findFirst({ where: { id } }); // aislado por marca (middleware)
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
    let newEnd = new Date(base.getTime() + days * 24 * 60 * 60 * 1000);

    // Si descontamos hasta el pasado, suspendemos. Si extendemos al
    // futuro, vuelve a TRIAL (reactiva expirados). El guard de arriba
    // ya excluyó ACTIVE pagante, así que acá solo procesamos TRIAL
    // y SUSPENDED.
    const newStatus = newEnd.getTime() <= now.getTime() ? 'SUSPENDED' : 'TRIAL';
    // Tope por créditos de la marca — solo al dejar el tenant en TRIAL.
    if (newStatus === 'TRIAL') {
      newEnd = await this.clampTrialEnd(t.whiteLabelId, newEnd, now);
    }

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
        whiteLabel: {
          select: {
            slug: true,
            name: true,
            domain: true,
            creditsUnlimited: true,
            // Branding de la marca → el panel /app hereda logo/colores/favicon
            // (sino el negocio de una marca blanca ve el verde + logo Clubify).
            logoUrl: true,
            iconUrl: true,
            faviconUrl: true,
            primaryColor: true,
            secondaryColor: true,
            backgroundColor: true,
            supportColor: true,
            // Contacto público de la marca → el apartado de suscripción
            // (Escríbenos por WhatsApp/email) usa estos, no los de Clubify.
            contactEmail: true,
            demoButtonWhatsApp: true,
            // Features que la marca incluye → lista "Tu suscripción incluye".
            subscriptionFeatureKeys: true,
            modules: {
              where: { module: { in: ['REVIEWS', 'COMMUNITY'] } },
              select: { module: true, enabled: true },
            },
          },
        },
        _count: { select: { cards: true, customers: true, products: true, locations: true } },
      },
    });
    if (!t) throw new NotFoundException();
    // Exponemos flags planos para el frontend. reviewsEnabled: el módulo
    // REVIEWS de la marca; sin registro (marcas viejas / sin marca) = true
    // para preservar el comportamiento actual (reseñas siempre activas).
    const mods = t.whiteLabel?.modules ?? [];
    const reviewsModule = mods.find((m) => m.module === 'REVIEWS');
    const communityModule = mods.find((m) => m.module === 'COMMUNITY');
    return {
      ...t,
      whiteLabelCreditsUnlimited: t.whiteLabel?.creditsUnlimited ?? false,
      reviewsEnabled: reviewsModule ? reviewsModule.enabled : true,
      // Módulo COMMUNITY (Comunidad/Lab). Marca con registro = su flag; marca
      // sin registro de COMMUNITY = false (oculto). Sin marca (legacy) = true
      // (los negocios legacy son de Clubify, que sí tiene Comunidad).
      communityEnabled: t.whiteLabel
        ? (communityModule?.enabled ?? false)
        : true,
      // Slug de la marca del negocio. null (marcas viejas / sin marca) se trata
      // como 'clubify' en el frontend. Se usa para gatear secciones exclusivas
      // (Comunidad/Lab) por marca, sin filtrar branding de otra.
      whiteLabelSlug: t.whiteLabel?.slug ?? null,
      // Nombre de la marca (para la identidad del asistente IA del panel).
      whiteLabelName: t.whiteLabel?.name ?? null,
      // Branding de la marca para el panel /app (null = Clubify → defaults).
      whiteLabelBranding: t.whiteLabel
        ? {
            logoUrl: t.whiteLabel.logoUrl,
            iconUrl: t.whiteLabel.iconUrl,
            faviconUrl: t.whiteLabel.faviconUrl,
            primaryColor: t.whiteLabel.primaryColor,
            secondaryColor: t.whiteLabel.secondaryColor,
            backgroundColor: t.whiteLabel.backgroundColor,
            supportColor: t.whiteLabel.supportColor,
          }
        : null,
      // Contacto de la marca para el apartado de suscripción (billing). Null
      // (Clubify / sin marca) → el frontend usa el contacto default de Clubify.
      brandContactEmail: t.whiteLabel?.contactEmail ?? null,
      brandSupportWhatsApp: t.whiteLabel?.demoButtonWhatsApp ?? null,
      // Dominio público de la marca (ej. selleala.com) → links públicos
      // (reservas, etc.) usan el dominio de la marca, no soyclubify.com.
      brandPublicDomain: t.whiteLabel?.domain ?? null,
      // Features que la marca incluye en su suscripción (keys i18n). Vacío =
      // lista completa por defecto. Solo aplica a marcas blancas (no Clubify).
      brandSubscriptionFeatureKeys: t.whiteLabel?.subscriptionFeatureKeys ?? [],
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
    const t = await this.prisma.tenant.findFirst({
      where: { id: tenantId }, // aislado por marca (middleware)
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
