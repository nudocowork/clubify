import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  UnauthorizedException,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { TenantStatus } from '@prisma/client';
import { JwtService } from '@nestjs/jwt';
import { resolveWalletAdvanced } from '../common/white-label/wallet-advanced.util';
import { PrismaService } from '../common/prisma/prisma.service';
import { AuthService } from '../auth/auth.service';
import { AuditService } from '../audit/audit.service';
import { invalidateTenantStatusCache } from '../common/guards/tenant-status.guard';
import { invalidateBusinessTypeCache } from '../common/guards/infolink-only.guard';
import { OnboardingWebhookService } from '../onboarding-sync/onboarding-webhook.service';
import { IncomeRecordService } from '../finance/income-record.service';
import { ReferralsService } from '../referrals/referrals.service';
import { CommissionRecalcService } from '../referrals/commission-recalc.service';
import { addPlanPeriod, normalizePlanPeriod } from '../common/plan-period';
import { getCanonicalBundlePrice } from '../common/plan-pricing';
import { resolveManualPaymentPeriod } from '../common/manual-payment-period';
import { cycleCreditCostForTenant, normalizeBusinessType, BusinessType } from '../common/business-types';
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
  /** Tipo de negocio / línea de producto (FULL=Negocio Completo, INFOLINK=Solo
   *  InfoLink). Default FULL. Determina el consumo de créditos y los módulos. */
  businessType?: BusinessType;
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
  slug: string;
  email: string;
  phone: string;
  logoUrl: string;
  primaryColor: string;
  secondaryColor: string;
  status: TenantStatus;
  planId: string;
  planPeriodicity: 'MENSUAL' | 'TRIMESTRAL' | 'SEMESTRAL' | 'ANUAL' | null;
  // Tipo de negocio (Completo / Solo InfoLink). Cambiarlo altera el consumo de
  // créditos futuro y los módulos visibles (guard InfoLinkOnly + sidebar).
  businessType: BusinessType;
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
  /** Varias cartas, una por sede. Ver modelo `Menu`. */
  multiMenuEnabled: boolean;
  /** Cuantas cartas EXTRA permite el admin. */
  maxExtraMenus: number;
}>;

export type UpdateMyTenantDto = Partial<{
  brandName: string;
  dataPolicyUrl: string | null;
  locale: string;
  phone: string;
  whatsappPhone: string;
  whatsappOrdersPhone: string;
  whatsappDeliveryPhone: string;
  whatsappReservationsPhone: string;
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
    private recalc: CommissionRecalcService,
    private onboardingWebhook: OnboardingWebhookService,
    // CONTABILIDAD Fase 1: histórico de ingreso real (pagos manuales). Best-effort.
    private incomeRecord: IncomeRecordService,
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
  async impersonate(tenantId: string, superAdminId: string | null) {
    // Seguridad: findFirst (NO findUnique) → el middleware lo acota a la marca
    // del admin. Un admin de otra marca NO puede impersonar este negocio.
    const tenant = await this.prisma.tenant.findFirst({
      where: { id: tenantId },
      select: {
        id: true,
        brandName: true,
        slug: true,
        status: true,
        // Branding de la marca blanca del negocio → el frontend lo guarda en el
        // backup de impersonation (sessionStorage) para sembrar el panel /app
        // con logo/color/nombre reales en el PRIMER paint (anti-flash FODT).
        // Sin esto, /app pinta el verde Clubify + logo genérico + "Mi Negocio"
        // hasta que responde el fetch async de /tenants/me.
        whiteLabel: {
          select: {
            slug: true,
            name: true,
            primaryColor: true,
            logoUrl: true,
            iconUrl: true,
          },
        },
      },
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
      impersonatedBy: superAdminId ?? 'team-enter',
    };
    const accessToken = this.jwt.sign(payload);

    // HOTFIX 2026-06-05: dejamos constancia real en AuditLog. Antes el
    // comentario decía "queda constancia en logs" pero NUNCA se llamaba
    // a audit.log → un SUPER_ADMIN/MARKETING podía impersonar tenants
    // sin rastro auditable. Con MARKETING expandido (M5) la superficie
    // creció. Ahora cada inicio de impersonación queda registrado con
    // actor=adminId, tenant=target, action=tenant.impersonate.
    this.audit.log({
      // actorId es FK a User; el contador de TeamClubify no es un User de
      // Clubify → null cuando la entrada viene del magic-link (A4).
      actorId: superAdminId ?? undefined,
      tenantId: tenant.id,
      action: 'tenant.impersonate',
      resource: `tenant:${tenant.id}`,
      metadata: {
        ownerImpersonated: owner.id,
        tenantSlug: tenant.slug,
        via: superAdminId ? 'admin' : 'team-enter-link',
      },
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
      tenant: {
        id: tenant.id,
        brandName: tenant.brandName,
        slug: tenant.slug,
        status: tenant.status,
        // Seed anti-flash para el panel /app (ver comentario del select).
        // primaryColor = color de la MARCA BLANCA (no del negocio), que es la
        // identidad que hereda el panel /app.
        whiteLabelSlug: tenant.whiteLabel?.slug ?? null,
        whiteLabelName: tenant.whiteLabel?.name ?? null,
        primaryColor: tenant.whiteLabel?.primaryColor ?? null,
        logoUrl: tenant.whiteLabel?.logoUrl ?? null,
        iconUrl: tenant.whiteLabel?.iconUrl ?? null,
      },
    };
  }

  /**
   * PDF Soft(9) A4: genera un magic-link de VIDA CORTA (15 min) para que el
   * contador entre a un negocio desde TeamClubify. El token del URL NO es la
   * sesión final: /entrar lo intercambia (enterExchange) por una sesión normal,
   * así el link caduca en 15 min aunque la sesión siga viva. Firmado con el
   * secreto JWT del backend (no falsificable) + marca kind:'enter'.
   */
  async mintEnterLink(tenantId: string): Promise<{ url: string }> {
    const owner = await this.prisma.user.findFirst({
      where: { tenantId, role: 'TENANT_OWNER', isActive: true },
      select: { id: true },
    });
    if (!owner) {
      throw new BadRequestException('El negocio no tiene un dueño activo.');
    }
    const token = this.jwt.sign(
      { tenantId, kind: 'enter', by: 'team-accountant' },
      { expiresIn: '15m' },
    );
    const base = process.env.CLUBIFY_APP_URL || 'https://soyclubify.com';
    return { url: `${base}/entrar?t=${encodeURIComponent(token)}` };
  }

  /**
   * PDF Soft(9) A4: intercambia el token corto del magic-link por una sesión de
   * impersonación normal (mismo payload que /impersonate). Público: el token
   * firmado ES la autorización. Rechaza si venció o no es un token 'enter'.
   */
  async enterExchange(token: string) {
    let decoded: any;
    try {
      decoded = this.jwt.verify(token);
    } catch {
      throw new UnauthorizedException('El enlace es inválido o venció.');
    }
    if (!decoded || decoded.kind !== 'enter' || !decoded.tenantId) {
      throw new UnauthorizedException('Enlace inválido.');
    }
    // Reutiliza impersonate (token de sesión normal + branding + auditoría).
    // actor=null → queda auditado como via 'team-enter-link'.
    return this.impersonate(decoded.tenantId, null);
  }

  /**
   * Cambia la contraseña del DUEÑO (TENANT_OWNER) de un negocio SIN pedir la
   * actual. Pensado para soporte: cuando el negocio olvidó su contraseña, el
   * admin puede setearle una nueva desde el panel. Queda auditado y se
   * invalidan los tokens viejos del dueño (passwordChangedAt). Brand-scoped
   * vía findFirst (un admin de otra marca no puede tocar este negocio).
   */
  async changeOwnerPasswordAdmin(
    tenantId: string,
    newPassword: string,
    actorId: string,
  ) {
    const pwd = (newPassword ?? '').trim();
    if (pwd.length < 8) {
      throw new BadRequestException(
        'La nueva contraseña debe tener al menos 8 caracteres.',
      );
    }
    const tenant = await this.prisma.tenant.findFirst({
      where: { id: tenantId },
      select: { id: true, brandName: true, slug: true },
    });
    if (!tenant) throw new NotFoundException('Negocio no encontrado');

    const owner = await this.prisma.user.findFirst({
      where: { tenantId, role: 'TENANT_OWNER', isActive: true },
      orderBy: { createdAt: 'asc' },
      select: { id: true, email: true },
    });
    if (!owner) {
      throw new BadRequestException(
        'Este negocio no tiene un TENANT_OWNER activo.',
      );
    }

    const passwordHash = await this.auth.hashPassword(pwd);
    await this.prisma.user.update({
      where: { id: owner.id },
      // passwordChangedAt invalida los JWT emitidos antes del cambio.
      data: { passwordHash, passwordChangedAt: new Date() },
    });

    this.audit.log({
      actorId,
      tenantId: tenant.id,
      action: 'tenant.owner.password_change',
      resource: `user:${owner.id}`,
      metadata: { tenantSlug: tenant.slug, ownerId: owner.id },
    });

    return { ok: true, ownerEmail: owner.email };
  }

  /**
   * El dueño activo del negocio: el mismo que elegiría `setOwnerPassword`
   * (TENANT_OWNER activo, el más antiguo). Se expone para que el panel de
   * soporte muestre A QUÉ correo le va a cambiar la contraseña ANTES de
   * escribirla, no después.
   */
  async ownerOfTenant(tenantId: string) {
    const owner = await this.prisma.user.findFirst({
      where: { tenantId, role: 'TENANT_OWNER', isActive: true },
      orderBy: { createdAt: 'asc' },
      select: { id: true, email: true, fullName: true, lastLoginAt: true },
    });
    if (!owner) return { owner: null };
    return {
      owner: {
        id: owner.id,
        email: owner.email,
        fullName: owner.fullName,
        lastLoginAt: owner.lastLoginAt,
      },
    };
  }

  /**
   * #11 (2026-06-16): ranking de negocios por cantidad de pases emitidos.
   * Mayor a menor por default; `order='asc'` invierte. Incluye negocios con
   * 0 pases. Excluye borrados.
   */
  /**
   * Ranking de negocios.
   *
   * `criterio`:
   *   - `pases`      → por cuántos pases han emitido (el de siempre).
   *   - `antiguedad` → por cuándo entraron. Sirve para lo contrario: ver quién
   *                    lleva más tiempo, que no siempre es quien más emite.
   *
   * `desde` acota los pases a los emitidos a partir de esa fecha, para poder
   * preguntar "quién movió más ESTE mes" en vez de arrastrar el histórico —
   * si no, los negocios veteranos copan la lista para siempre y no se ve quién
   * está creciendo ahora.
   */
  async rankingByPasses(
    order: 'asc' | 'desc' = 'desc',
    user?: AuthUser,
    criterio: 'pases' | 'antiguedad' = 'pases',
    desde?: Date | null,
  ) {
    // Aislamiento por MARCA BLANCA: cada marca ve SOLO el ranking de SUS
    // negocios (mismo scoping que list()). Sin marca en sesión → default
    // Clubify (+ legacy null). El cross-brand global vive en /superadmin.
    const brandWhere = await this.brandTenantWhere(user?.whiteLabelId ?? null);
    const tenants = await this.prisma.tenant.findMany({
      where: { deletedAt: null, isCampaignHost: false, ...brandWhere },
      select: {
        id: true,
        brandName: true,
        name: true,
        status: true,
        createdAt: true,
      },
    });

    // Los pases del período, y aparte SIEMPRE el total histórico: cuando se
    // filtra por fecha hay que poder comparar "40 este mes, de 1.200 en total".
    // Sin el total al lado, el número del período no dice nada.
    const ids = tenants.map((t) => t.id);
    const [delPeriodo, historico] = await Promise.all([
      this.prisma.pass.groupBy({
        by: ['tenantId'],
        where: {
          tenantId: { in: ids },
          ...(desde ? { issuedAt: { gte: desde } } : {}),
        },
        _count: { _all: true },
      }),
      desde
        ? this.prisma.pass.groupBy({
            by: ['tenantId'],
            where: { tenantId: { in: ids } },
            _count: { _all: true },
          })
        : Promise.resolve(null),
    ]);

    const mapaPeriodo = new Map(delPeriodo.map((g) => [g.tenantId, g._count._all]));
    const mapaTotal = historico
      ? new Map(historico.map((g) => [g.tenantId, g._count._all]))
      : mapaPeriodo;

    const rows = tenants.map((t) => ({
      id: t.id,
      brandName: t.brandName || t.name,
      status: t.status,
      /** Pases del período consultado (o el total, si no se filtró). */
      passCount: mapaPeriodo.get(t.id) ?? 0,
      /** Total histórico, siempre. Es la referencia para leer el anterior. */
      passTotal: mapaTotal.get(t.id) ?? 0,
      createdAt: t.createdAt,
    }));

    if (criterio === 'antiguedad') {
      // `desc` = los más antiguos primero, que es lo que se busca al ordenar
      // por antigüedad. Ordenar por fecha descendente daría los más nuevos y
      // sería justo lo contrario de lo que dice el botón.
      rows.sort((a, b) =>
        order === 'desc'
          ? a.createdAt.getTime() - b.createdAt.getTime()
          : b.createdAt.getTime() - a.createdAt.getTime(),
      );
    } else {
      rows.sort((a, b) =>
        order === 'asc' ? a.passCount - b.passCount : b.passCount - a.passCount,
      );
    }
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
      // isCampaignHost: el tenant de sistema de Cuponera no es un negocio real.
      where: { deletedAt: null, isCampaignHost: false, ...where },
      include: {
        plan: true,
        businessGroup: { select: { id: true, name: true, status: true } },
        _count: { select: { users: true, cards: true, customers: true } },
        // slug de la marca → el panel /admin puede mostrar columnas propias por
        // marca (ej. Sellea: vencimiento del servicio en vez de pedidos/revenue).
        whiteLabel: { select: { slug: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (tenants.length === 0) return [];

    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    // Conteo y plata van en bases distintas (regla 2026-08-20): orders30 mide
    // actividad (todo menos cancelados) pero revenue30 solo suma pedidos que
    // llegaron a CONFIRMED+ — un PENDING eterno no es facturación del negocio.
    const [orderStats, revenueStats] = await Promise.all([
      this.prisma.order.groupBy({
        by: ['tenantId'],
        where: { createdAt: { gte: since }, status: { not: 'CANCELLED' } },
        _count: { _all: true },
      }),
      this.prisma.order.groupBy({
        by: ['tenantId'],
        where: {
          createdAt: { gte: since },
          status: { in: ['CONFIRMED', 'READY', 'DELIVERED'] },
        },
        _sum: { total: true },
      }),
    ]);
    const revByTenant = new Map(
      revenueStats.map((s) => [s.tenantId, Number(s._sum.total ?? 0)]),
    );
    const byTenant = new Map(
      orderStats.map((s) => [
        s.tenantId,
        { count: s._count._all, total: revByTenant.get(s.tenantId) ?? 0 },
      ]),
    );

    const now = Date.now();
    return tenants.map((t) => {
      const stat = byTenant.get(t.id) ?? { count: 0, total: 0 };
      const daysLeftInTrial = t.trialEndsAt
        ? Math.max(0, Math.ceil((t.trialEndsAt.getTime() - now) / (24 * 60 * 60 * 1000)))
        : null;
      return {
        ...t,
        whiteLabelSlug: t.whiteLabel?.slug ?? null,
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
            // Visibilidad de la tarjeta "Grow Business · SMS" por marca (solo UI).
            showGrowBusinessCard: true,
            // Pasarela de pago de la marca → el detalle muestra dinámicamente
            // "Pasarela: Stripe/Hotmart/…" + el identificador correcto (PDF 1256
            // §1). Reutilizable para cualquier marca sin tocar código.
            paymentGateway: true,
            // Créditos de la marca → el detalle gatea trial/activación (PDF 752
            // #5): marca blanca sin créditos NO puede activar; y nunca da trial.
            creditsAvailable: true,
            creditsUnlimited: true,
            modules: { where: { enabled: true }, select: { module: true } },
            // Planes de pago de la marca → el modal "Cambiar plan" muestra SOLO
            // las periodicidades/precios de la marca del negocio (no los de
            // Clubify). Sellea = Mensual + Anual con sus precios.
            paymentLinks: {
              where: { active: true },
              orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
              select: { periodicity: true, amountUsd: true, url: true, gateway: true },
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
    // FILTRO por pasarela ACTIVA de la marca: un link de otra pasarela (ej. un
    // link de prueba de Cross en Clubify, que cobra por Hotmart) NO debe
    // aparecer como "plan de la marca" ni tapar los planes reales del landing.
    const brandGateway = tenant.whiteLabel?.paymentGateway ?? null;
    const brandPlans =
      tenant.whiteLabel?.paymentLinks
        ?.filter((l) => !brandGateway || l.gateway === brandGateway)
        .map((l) => ({
          periodicity: l.periodicity,
          amountUsd: l.amountUsd != null ? Number(l.amountUsd) : null,
          url: l.url ?? null,
        })) ?? [];
    // Estado de créditos de la marca para gatear la UI (PDF 752 #5). Un negocio
    // de MARCA BLANCA (no-Clubify) no recibe trial y solo se activa con créditos:
    //  - isWhiteLabel: el negocio pertenece a una marca blanca (no Clubify).
    //  - canActivate: la marca puede activar (ilimitada o con ≥1 crédito).
    // Para Clubify / sin marca → no hay restricción (canActivate true, sin gate).
    const wl = tenant.whiteLabel;
    const isWhiteLabel = !!wl && wl.slug !== 'clubify';
    // Costo del ciclo según tipo de negocio × periodicidad (InfoLink = 0.25/mes).
    const activationCost = cycleCreditCostForTenant(tenant.businessType, tenant.infolinkTier, tenant.planPeriodicity);
    const brandCredits = {
      isWhiteLabel,
      unlimited: isWhiteLabel ? !!wl?.creditsUnlimited : true,
      available: isWhiteLabel ? wl?.creditsAvailable ?? 0 : 0,
      // Créditos que costará activar este negocio (según su tipo/periodicidad).
      cost: activationCost,
      canActivate: isWhiteLabel
        ? !!wl?.creditsUnlimited || (wl?.creditsAvailable ?? 0) >= activationCost
        : true,
    };
    // PDF 925 #2: el "Modo de reparto de comisión" solo aplica si el negocio
    // tiene un VENDEDOR en su cadena (el modo define cómo se le paga). Sin
    // vendedor, el card no debe mostrarse.
    const hasVendor =
      (await this.prisma.referralUse.count({
        where: {
          tenantId: id,
          status: { in: ['SIGNED_UP', 'ACTIVE', 'PAYING'] },
          referralCode: { role: 'VENDOR' },
        },
      })) > 0;
    // PDF 1256 §1: pasarela + identificador de suscripción dinámicos por marca.
    // Clubify / sin marca → HOTMART por default. El identificador se toma del
    // campo correcto según la pasarela (reutilizable para cualquier marca).
    const gateway = wl?.paymentGateway ?? 'HOTMART';
    const subscriptionIdentifier =
      gateway === 'STRIPE'
        ? tenant.stripeSubscriptionId ?? null
        : gateway === 'HOTMART' || gateway === 'MANUAL'
          ? tenant.hotmartSubscriberCode ?? null
          : tenant.stripeSubscriptionId ?? tenant.hotmartSubscriberCode ?? null;
    const subscription = {
      gateway,
      identifier: subscriptionIdentifier,
      // true si el identificador es un placeholder auto-generado (wl-…/manual-…)
      // y no un id real de la pasarela.
      isPlaceholder:
        !!subscriptionIdentifier &&
        /^(wl-|manual-|comp-|trial-|sim-)/i.test(subscriptionIdentifier),
    };
    // La PASARELA de la marca viaja al frontend para que los textos no digan
    // "Hotmart" a alguien que paga con Stripe. Es null para Clubify/sin marca,
    // y el frontend cae a un genérico ("la pasarela de pagos").
    return {
      ...tenant,
      enabledModules,
      brandPlans,
      brandCredits,
      brandGateway,
      hasVendor,
      subscription,
    };
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

  /** Normaliza un texto a slug (minúsculas, guiones, sin acentos sobrantes). */
  private slugify(s: string): string {
    return (
      s
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '')
        .slice(0, 40) || `tenant-${nanoid(6)}`
    );
  }

  /** Asegura un slug ÚNICO GLOBAL (las URLs /m/<slug> y subdominios lo exigen).
   *  Si choca, agrega sufijo -2, -3… (y nanoid al final). `excludeId` permite
   *  editar el slug del propio tenant sin chocar consigo mismo. */
  private async ensureUniqueSlug(base: string, excludeId?: string): Promise<string> {
    let slug = base;
    for (let n = 2; n <= 99; n++) {
      const exists = await this.prisma.tenant.findUnique({ where: { slug } });
      if (!exists || exists.id === excludeId) break;
      slug = `${base.slice(0, 37)}-${n}`;
      if (n === 99) slug = `${base.slice(0, 33)}-${nanoid(6)}`;
    }
    return slug;
  }

  async create(dto: CreateTenantDto, user?: AuthUser) {
    // El email del dueño se convierte en un User con email ÚNICO GLOBAL. Si el
    // correo ya está registrado (ej. el admin usó su propio email, o el dueño ya
    // tiene otro negocio), el create anidado del User lanzaba P2002 sin capturar
    // → 500 "Internal server error" opaco. Pre-chequeamos para devolver un 400
    // claro y accionable en vez de un 500.
    if (dto.email) {
      // Mismo valor que se insertará como User.email (case-sensitive, sin
      // normalizar) para reflejar exactamente el constraint @unique.
      const existingUser = await this.prisma.user.findUnique({
        where: { email: dto.email },
        select: { id: true },
      });
      if (existingUser) {
        throw new BadRequestException(
          'Ya existe un usuario con ese email. Usá otro correo para el dueño del negocio.',
        );
      }
    }

    // #3: el MISMO nombre puede existir en marcas blancas distintas (Clubify y
    // Sellea pueden tener cada uno "Mi Restaurante"). El slug se mantiene
    // ÚNICO GLOBAL, así que si choca le agregamos un sufijo.
    const slug = await this.ensureUniqueSlug(this.slugify(dto.brandName));

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
    // Bug 2 (auditoría facturación 2026-08-17): fecha de cobro real. Se setea SOLO
    // en activaciones que representan un cobro (manual con fecha, código Hotmart
    // verificado, o crédito de marca ilimitada). NO en cortesía (freeAccount) ni
    // trial. Antes las altas por crédito de marca (`wl-`) nacían ACTIVE sin
    // lastChargeAt → invisibles en el panel de facturación (contadas como ~est).
    let lastChargeAt: Date | null = null;

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
      lastChargeAt = new Date(); // cobro manual con fecha → activación real
    } else if (dto.hotmartSubscriberCode) {
      status = 'ACTIVE';
      hotmartCode = dto.hotmartSubscriberCode.trim();
      lastChargeAt = new Date(); // pago ya verificado por el admin → activación real
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
        // Extiende por la periodicidad elegida (Anual = +12 meses), no +30 fijos.
        currentPeriodEnd = addPlanPeriod(new Date(), dto.planPeriodicity);
        trialEndsAt = null;
        lastChargeAt = new Date(); // Bug 2: alta por crédito de marca = cobro real
      } else {
        status = 'SUSPENDED';
        hotmartCode = `wl-${nanoid(10)}`;
        currentPeriodEnd = null;
        trialEndsAt = null;
        lastChargeAt = null; // nace bloqueado; el crédito lo activa después (setea allí)
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
        // Tipo de negocio (Completo por defecto). Solo InfoLink consume 0.25/mes
        // y ve un panel reducido; el guard backend bloquea el resto de módulos.
        businessType: normalizeBusinessType(dto.businessType),
        planId,
        // #2/#6: el negocio hereda la MARCA BLANCA del admin que lo crea, así
        // aparece solo en esa marca y nunca en otra (Sellea→sellea, Clubify→clubify).
        // PDF 2026-06-30: si el admin no tiene marca en sesión (plataforma/Clubify),
        // asignamos EXPLÍCITAMENTE la marca Clubify en vez de dejar null. Antes los
        // negocios creados por admins de Clubify quedaban whiteLabelId=null → conteos
        // inconsistentes entre vistas (54 vs 46). Nunca más nulls nuevos.
        whiteLabelId: user?.whiteLabelId ?? (await this.clubifyWlId()),
        planPeriodicity: dto.planPeriodicity ?? null,
        referredByCode: dto.referredByCode,
        status,
        trialStartedAt,
        trialEndsAt,
        currentPeriodEnd,
        lastChargeAt, // Bug 2: fecha de cobro real (null en trial/cortesía)
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

    // Fase D: si el negocio NACE ACTIVE (freeAccount / nextChargeDate / hotmart /
    // marca ilimitada) avisamos al onboarding para que dispare su bienvenida.
    // Best-effort, fire-and-forget (nunca rompe la creación).
    if (tenant.status === 'ACTIVE') {
      void this.onboardingWebhook.emitBusinessActivated(tenant.id);
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
    // PDF 925: slug editable. Normaliza + asegura unicidad global (excluyendo
    // el propio tenant). Vacío o sin cambio real = no se toca. Cambiar el slug
    // actualiza todas las URLs dinámicas (storefront/QR/wallet se recomputan en
    // runtime); las URLs externas ya compartidas con el slug viejo se rompen.
    const data: any = { ...dto };
    if (typeof dto.slug === 'string' && dto.slug.trim()) {
      const normalized = this.slugify(dto.slug);
      data.slug =
        normalized === before.slug
          ? before.slug
          : await this.ensureUniqueSlug(normalized, id);
    } else {
      delete data.slug;
    }
    const updated = await this.prisma.tenant.update({
      where: { id },
      // `as any`: deliveryAlertsPhones/Events son columnas Json (string[]|null)
      // y Prisma no acepta el tipo directo. Mismo patrón que updateMine.
      data,
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
    // PDF 1254: si cambió la PERIODICIDAD del plan (ej. Trimestral → Semestral),
    // la comisión debe reflejar el nuevo plan. La base es el precio; cuando el
    // precio guardado NO era custom (era el canónico del plan anterior o null),
    // lo movemos al canónico del NUEVO plan y recalculamos. Un precio custom se
    // respeta (no se pisa). Si el admin mandó un precio explícito en este mismo
    // update, ese gana y no tocamos nada acá.
    if (
      dto.planPeriodicity !== undefined &&
      dto.planPeriodicity !== (before as any).planPeriodicity
    ) {
      if (dto.subscriptionPriceUsd === undefined) {
        const oldCanon = await this.recalc.getBundlePrice(
          (before as any).planPeriodicity ?? null,
        );
        const cur = Number((before as any).subscriptionPriceUsd ?? NaN);
        const priceWasCanonicalOrNull =
          !Number.isFinite(cur) || (oldCanon > 0 && cur === oldCanon);
        if (priceWasCanonicalOrNull) {
          const newCanon = await this.recalc.getBundlePrice(dto.planPeriodicity);
          if (newCanon > 0) {
            await this.prisma.tenant.update({
              where: { id },
              data: { subscriptionPriceUsd: newCanon },
            });
          }
        }
      }
      this.referrals
        .recalcTenantSplit(id, null, 'plan_periodicity_change')
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
    // Si cambió el tipo de negocio (Completo ↔ Solo InfoLink), invalidamos el
    // cache del guard para que el bloqueo/desbloqueo de módulos propague ya.
    if (
      dto.businessType !== undefined &&
      dto.businessType !== (before as any).businessType
    ) {
      invalidateBusinessTypeCache(id);
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
    // whiteLabelId del que ejecuta. Si viene seteado = admin de MARCA BLANCA:
    // NO puede fijar una fecha de cobro arbitraria (se ancla a la activación).
    // null/undefined = plataforma (Clubify), que sí conserva el override manual.
    actorWhiteLabelId?: string | null,
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
          // Activación manual = fecha de cobro real → monto facturado por rango.
          lastChargeAt: now,
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
          // Activación manual = fecha de cobro real → monto facturado por rango.
          lastChargeAt: now,
        };
        if (actorWhiteLabelId) {
          // Marca blanca: la fecha NO es editable. Se ancla a la activación
          // (hoy + periodo del plan), igual que la activación por crédito.
          // Regla del dueño 2026-08-29 — "las fechas = cuando se activan los
          // créditos, y la marca blanca no las puede modificar".
          data.currentPeriodEnd = addPlanPeriod(now, previous.planPeriodicity);
        } else if (dto.nextChargeDate) {
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

    // Activar un negocio de una MARCA BLANCA (no ilimitada) por el simulador de
    // facturación TAMBIÉN descuenta 1 crédito. Antes esta vía (paid/free) ponía
    // el negocio ACTIVE GRATIS, bypaseando el popup de créditos → la marca
    // terminaba con negocios activos sin consumo (bug Sellea 2026-06-25). Solo
    // al pasar a ACTIVE (no si ya estaba activo, para no recobrar en ediciones)
    // y solo marcas no-Clubify no-ilimitadas. Clubify (Hotmart) no usa créditos.
    let consumedBrandCredit = false;
    // Costo del ciclo según tipo de negocio × periodicidad (InfoLink mensual=0.25).
    const activationCost = cycleCreditCostForTenant(previous.businessType, previous.infolinkTier, previous.planPeriodicity);
    const activatesNow =
      (dto.mode === 'free' || dto.mode === 'paid') && previous.status !== 'ACTIVE';
    if (activatesNow && previous.whiteLabelId) {
      const wl = await this.prisma.whiteLabel.findUnique({
        where: { id: previous.whiteLabelId },
        select: { id: true, slug: true, creditsUnlimited: true },
      });
      if (wl && wl.slug !== 'clubify' && !wl.creditsUnlimited) {
        const debit = await this.prisma.whiteLabel.updateMany({
          where: { id: wl.id, creditsAvailable: { gte: activationCost } },
          data: { creditsAvailable: { decrement: activationCost }, creditsUsed: { increment: activationCost } },
        });
        if (debit.count === 0) {
          throw new ForbiddenException(
            'La marca no tiene créditos disponibles. Compra un pack para activar este negocio.',
          );
        }
        consumedBrandCredit = true;
      }
    }

    let updated;
    try {
      updated = await this.prisma.tenant.update({ where: { id }, data });
    } catch (e) {
      // Rollback del crédito si la activación falló.
      if (consumedBrandCredit && previous.whiteLabelId) {
        await this.prisma.whiteLabel
          .update({
            where: { id: previous.whiteLabelId },
            data: { creditsAvailable: { increment: activationCost }, creditsUsed: { decrement: activationCost } },
          })
          .catch(() => undefined);
      }
      throw e;
    }
    if (consumedBrandCredit && previous.whiteLabelId) {
      await this.prisma.creditTransaction
        .create({
          data: {
            whiteLabelId: previous.whiteLabelId,
            type: 'CONSUME',
            amount: -activationCost,
            tenantId: id,
            note: `Activación (simulador ${dto.mode}) · ${previous.brandName} · ${activationCost} créd`,
          },
        })
        .catch(() => undefined);
    }
    // Invalidamos el cache del TenantStatusGuard — sino las escrituras de este
    // tenant siguen 402 hasta 30s después del switch a TRIAL/ACTIVE/free.
    invalidateTenantStatusCache(id);
    // Fase D (Onboarding Sync): al ACTIVAR por panel/simulador, avisamos al
    // onboarding con el webhook saliente `business.activated`. Fire-and-forget,
    // best-effort — jamás rompe ni retrasa la activación.
    if (activatesNow) void this.onboardingWebhook.emitBusinessActivated(id);
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
      select: {
        id: true,
        status: true,
        brandName: true,
        suspendedAt: true,
        whiteLabelId: true,
        businessType: true,
        infolinkTier: true,
        planPeriodicity: true,
      },
    });
    if (!previous) throw new NotFoundException('Tenant');
    const data: any = { status };
    if (status === 'ACTIVE') {
      data.suspendedAt = null;
      // "Marcar como activo" = fecha de cobro real → monto facturado por rango.
      data.lastChargeAt = new Date();
    }
    if (status === 'SUSPENDED') data.suspendedAt = new Date();
    // Marca blanca: pasar a ACTIVE consume 1 crédito (bloquea si no hay).
    const credit =
      status === 'ACTIVE'
        ? await this.chargeBrandCreditForActivation(previous, 'marcar activo')
        : { rollback: async () => {}, commit: async () => {} };
    let updated;
    try {
      updated = await this.prisma.tenant.update({ where: { id }, data });
    } catch (e) {
      await credit.rollback();
      throw e;
    }
    await credit.commit();
    invalidateTenantStatusCache(id);
    // Fase D: transición REAL a ACTIVE (no-op si ya estaba activo) → webhook.
    if (status === 'ACTIVE' && previous.status !== 'ACTIVE') {
      void this.onboardingWebhook.emitBusinessActivated(id);
    }
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
  /**
   * Débito de 1 crédito de la marca al ACTIVAR un negocio de marca blanca
   * (no-Clubify, no-ilimitada). Race-safe (updateMany con guard). Lanza
   * ForbiddenException si la marca no tiene créditos. Para Clubify / sin marca
   * / ilimitada / negocio ya ACTIVE no hace nada. Devuelve `rollback` (revertir
   * si la escritura posterior falla) y `commit` (registrar la CreditTransaction).
   * Unifica la regla "marca blanca SIN créditos NO PUEDE ACTIVAR negocios"
   * en todas las vías manuales (marcar pagado / marcar activo / simulador).
   */
  private async chargeBrandCreditForActivation(
    previous: {
      id: string;
      whiteLabelId: string | null;
      status: TenantStatus;
      brandName: string;
      businessType?: string | null;
      infolinkTier?: string | null;
      planPeriodicity?: string | null;
    },
    source: string,
  ): Promise<{ rollback: () => Promise<void>; commit: () => Promise<void> }> {
    const noop = { rollback: async () => {}, commit: async () => {} };
    // Solo al PASAR a ACTIVE (no recobra si ya estaba activo) y solo marcas.
    if (previous.status === 'ACTIVE' || !previous.whiteLabelId) return noop;
    const wl = await this.prisma.whiteLabel.findUnique({
      where: { id: previous.whiteLabelId },
      select: { id: true, slug: true, creditsUnlimited: true },
    });
    if (!wl || wl.slug === 'clubify' || wl.creditsUnlimited) return noop;
    // Costo según tipo de negocio × periodicidad (InfoLink mensual = 0.25).
    const cost = cycleCreditCostForTenant(previous.businessType, previous.infolinkTier, previous.planPeriodicity);
    const debit = await this.prisma.whiteLabel.updateMany({
      where: { id: wl.id, creditsAvailable: { gte: cost } },
      data: { creditsAvailable: { decrement: cost }, creditsUsed: { increment: cost } },
    });
    if (debit.count === 0) {
      throw new ForbiddenException(
        'La marca no tiene créditos disponibles. Compra un pack para activar este negocio.',
      );
    }
    return {
      rollback: async () => {
        await this.prisma.whiteLabel
          .update({
            where: { id: wl.id },
            data: { creditsAvailable: { increment: cost }, creditsUsed: { decrement: cost } },
          })
          .catch(() => undefined);
      },
      commit: async () => {
        await this.prisma.creditTransaction
          .create({
            data: {
              whiteLabelId: wl.id,
              type: 'CONSUME',
              amount: -cost,
              tenantId: previous.id,
              note: `Activación (${source}) · ${previous.brandName} · ${cost} créd`,
            },
          })
          .catch(() => undefined);
      },
    };
  }

  async convertToPaying(id: string, actorId: string) {
    const t = await this.prisma.tenant.findFirst({ where: { id } }); // aislado por marca (middleware)
    if (!t) throw new NotFoundException('Tenant');
    const now = new Date();
    // FIX 2026-08-20: se ELIMINÓ el override `periodDays`. El frontend lo
    // mandaba SIEMPRE en 30, así que "marcar pagado" a un plan trimestral o
    // anual daba 30 días en vez del ciclo real. Ningún caller lo usaba con
    // intención legítima; la periodicidad del plan manda (1/3/6/12 meses).
    const newPeriodEnd = addPlanPeriod(now, t.planPeriodicity);
    // Marca blanca: "marcar pagado" ACTIVA → consume 1 crédito (bloquea si no hay).
    const credit = await this.chargeBrandCreditForActivation(t, 'marcar pagado');
    let updated;
    try {
      updated = await this.prisma.tenant.update({
        where: { id },
        data: {
          status: 'ACTIVE',
          suspendedAt: null,
          trialEndsAt: null,
          currentPeriodEnd: newPeriodEnd,
          // Pago manual = fecha de cobro real → alimenta "monto facturado" por rango.
          lastChargeAt: now,
          // Resetear contador de fallos al convertir manual (asumimos que
          // el pago manual reseta cualquier fallo previo).
          failedPaymentCount: 0,
        },
      });
    } catch (e) {
      await credit.rollback();
      throw e;
    }
    await credit.commit();
    invalidateTenantStatusCache(id);
    // Fase D: transición a ACTIVE (marcar pagado) → webhook business.activated.
    if (t.status !== 'ACTIVE') {
      void this.onboardingWebhook.emitBusinessActivated(id);
    }

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

  // ──────────── Pagos manuales (Nequi / efectivo / transferencia) ────────────

  /**
   * Registra un cobro hecho POR FUERA de las pasarelas y deja el negocio al
   * día. Como ninguna pasarela va a confirmar este pago, este registro es la
   * única verdad de que el ciclo quedó cubierto:
   *   - crea la fila ManualPayment con el ciclo cubierto (ver
   *     resolveManualPaymentPeriod: encadena desde currentPeriodEnd si el
   *     ciclo vigente no venció; si venció, arranca hoy),
   *   - activa el negocio, avanza currentPeriodEnd y limpia la mora,
   *   - limpia los flags de dedup de recordatorios para que la serie del
   *     ciclo NUEVO vuelva a salir,
   *   - consume el crédito de marca solo si esto ACTIVA el negocio
   *     (chargeBrandCreditForActivation, misma regla que "marcar pagado" —
   *     ya respeta la periodicidad),
   *   - audita quién registró, cuánto y qué ciclo cubre.
   */
  async registerManualPayment(
    id: string,
    dto: {
      method: 'NEQUI' | 'EFECTIVO' | 'TRANSFERENCIA' | 'OTRO';
      amount?: number;
      currency?: string;
      reference?: string;
      note?: string;
      paidAt?: string;
    },
    actorId: string,
  ) {
    const t = await this.prisma.tenant.findFirst({ where: { id } }); // aislado por marca (middleware)
    if (!t) throw new NotFoundException('Tenant');
    const now = new Date();
    const paidAt = dto.paidAt ? new Date(dto.paidAt) : now;
    if (Number.isNaN(paidAt.getTime())) {
      throw new BadRequestException('Fecha de pago inválida');
    }
    // Margen de 1 día por zonas horarias; más allá es un error de captura
    // (un pago "futuro" no existe todavía y correría mal el historial).
    if (paidAt.getTime() > now.getTime() + 24 * 60 * 60 * 1000) {
      throw new BadRequestException('La fecha de pago no puede ser futura');
    }
    // La FECHA DE PAGO manda: trimestral pagado el 4-jul queda cubierto hasta
    // el 4-oct. Antes se pasaba `now` y la fecha escrita por el usuario no se
    // usaba para nada — se guardaba en el historial y el ciclo salía de otro
    // lado. Ver `manual-payment-period.ts`.
    const period = resolveManualPaymentPeriod(
      paidAt,
      t.currentPeriodEnd,
      t.planPeriodicity,
    );
    // Marca blanca: si esto ACTIVA el negocio consume el crédito del ciclo
    // (no-op si ya estaba ACTIVE, o si la marca es Clubify/ilimitada).
    const credit = await this.chargeBrandCreditForActivation(t, 'pago manual');
    let payment;
    let updated;
    try {
      [payment, updated] = await this.prisma.$transaction([
        this.prisma.manualPayment.create({
          data: {
            tenantId: t.id,
            whiteLabelId: t.whiteLabelId,
            method: dto.method,
            amount: dto.amount ?? null,
            currency: dto.currency ? dto.currency.toUpperCase() : null,
            reference: dto.reference ?? null,
            note: dto.note ?? null,
            paidAt,
            periodStart: period.periodStart,
            periodEnd: period.periodEnd,
            periodicity: period.periodicity,
            actorId,
          },
        }),
        this.prisma.tenant.update({
          where: { id },
          data: {
            status: 'ACTIVE',
            suspendedAt: null,
            trialEndsAt: null,
            currentPeriodEnd: period.periodEnd,
            // Fecha del cobro REAL (no la de registro) → "monto facturado" por rango.
            lastChargeAt: paidAt,
            failedPaymentCount: 0,
            // Dedup por ciclo: los crons comparan estos campos contra
            // currentPeriodEnd (o el día del envío). Si no se limpian, el
            // negocio NO recibe ningún aviso del ciclo nuevo — el fallo
            // silencioso más probable de este flujo. Mismo reset que hace
            // hotmart.service al procesar una renovación real.
            preReminder7dSentFor: null,
            preReminder3dSentFor: null,
            preReminderTodaySentFor: null,
            paymentReminderSentFor: null,
            paymentFailureNoticeSentAt: null,
            pausePendingNoticeSentAt: null,
            // Permite volver a liberar el crédito de marca si el negocio se
            // suspende en un ciclo futuro (espejo de clearCreditRelease).
            creditReleasedAt: null,
          },
        }),
      ]);
    } catch (e) {
      await credit.rollback();
      throw e;
    }
    await credit.commit();
    // CONTABILIDAD (Fase 1): ingreso real del pago manual (si trae monto). Solo
    // USD por ahora — un pago en moneda local (COP) mezclaría monedas en el
    // libro USD; el soporte multi-moneda es de una fase posterior. Best-effort.
    if (!dto.currency || dto.currency.toUpperCase() === 'USD') {
      void this.incomeRecord.record({
        gateway: 'MANUAL',
        externalTxId: payment.id,
        tenantId: t.id,
        whiteLabelId: t.whiteLabelId,
        brandName: t.brandName,
        planPeriodicity: t.planPeriodicity,
        currency: 'USD',
        grossUsd: dto.amount ?? null,
        isFirstPayment: !t.currentPeriodEnd,
        saleDate: paidAt,
      });
    }
    invalidateTenantStatusCache(id);
    // Transición real a ACTIVE (primer pago o reactivación) → webhook.
    if (t.status !== 'ACTIVE') {
      void this.onboardingWebhook.emitBusinessActivated(id);
    }
    this.audit.log({
      actorId,
      tenantId: id,
      action: 'tenant.manual_payment_registered',
      resource: `manual_payment:${payment.id}`,
      metadata: {
        brandName: t.brandName,
        method: dto.method,
        amount: dto.amount ?? null,
        currency: dto.currency ?? null,
        reference: dto.reference ?? null,
        paidAt: paidAt.toISOString(),
        periodStart: period.periodStart.toISOString(),
        periodEnd: period.periodEnd.toISOString(),
        periodicity: period.periodicity,
        // Queda en auditoría: si el pago acorta la cobertura anterior, se ve
        // quien lo hizo y desde qué fecha.
        acortaCoberturaPrevia: period.acorta,
        previousStatus: t.status,
        previousPeriodEnd: t.currentPeriodEnd?.toISOString() ?? null,
      },
    });

    // Comisión del afiliado, igual que en «marcar pagado» (`convertToPaying`).
    // Un cobro por Nequi o efectivo es el MISMO hecho económico que uno por
    // pasarela: quien refirió al negocio cobra igual. No hacerlo aquí dejaba
    // sin pagar a los afiliados de todo negocio que cobra por fuera — y en
    // silencio, porque nada lo reporta.
    //
    // Fire-and-forget a propósito: si el cálculo falla no se cae el registro
    // del pago (que ya ocurrió y no se puede deshacer); el admin tiene
    // «Generar comisión ahora» para reintentarlo a mano.
    this.referrals
      .backfillCommissionForCurrentAssignment(id, false)
      .catch(() => null);

    return {
      payment,
      tenant: {
        id: updated.id,
        status: updated.status,
        currentPeriodEnd: updated.currentPeriodEnd,
        lastChargeAt: updated.lastChargeAt,
        suspendedAt: updated.suspendedAt,
        manualPayment: updated.manualPayment,
      },
    };
  }

  /** Marca / desmarca el negocio como "paga por fuera" (Tenant.manualPayment).
   *  Con el flag activo el cron de mora NO lo suspende solo (nadie puede
   *  confirmar sus pagos), sigue recibiendo los recordatorios, y entra a la
   *  lista de revisión cuando su ciclo vence sin pago manual que lo cubra. */
  async setManualPaymentMode(id: string, enabled: boolean, actorId: string) {
    const t = await this.prisma.tenant.findFirst({
      where: { id }, // aislado por marca (middleware)
      select: { id: true, brandName: true, manualPayment: true },
    });
    if (!t) throw new NotFoundException('Tenant');
    // Idempotente: sin cambio real no ensuciamos la auditoría.
    if (t.manualPayment === enabled) {
      return { id: t.id, manualPayment: t.manualPayment };
    }
    const updated = await this.prisma.tenant.update({
      where: { id },
      data: { manualPayment: enabled },
      select: { id: true, manualPayment: true },
    });
    this.audit.log({
      actorId,
      tenantId: id,
      action: 'tenant.manual_payment_mode_changed',
      resource: `tenant:${id}`,
      metadata: { brandName: t.brandName, from: t.manualPayment, to: enabled },
    });
    return updated;
  }

  /** Historial de pagos manuales del negocio + contexto para el modal de
   *  registro: importe sugerido = precio canónico según la periodicidad del
   *  plan, con override por Setting (la misma verdad que usa Hotmart para
   *  comisiones — ver common/plan-pricing). */
  async listManualPayments(id: string) {
    const t = await this.prisma.tenant.findFirst({
      where: { id }, // aislado por marca (middleware)
      select: {
        id: true,
        brandName: true,
        status: true,
        manualPayment: true,
        planPeriodicity: true,
        currentPeriodEnd: true,
      },
    });
    if (!t) throw new NotFoundException('Tenant');
    const payments = await this.prisma.manualPayment.findMany({
      where: { tenantId: id },
      orderBy: { paidAt: 'desc' },
    });
    const suggestedAmount = await getCanonicalBundlePrice(
      this.prisma,
      t.planPeriodicity,
    );
    return {
      tenantId: t.id,
      brandName: t.brandName,
      status: t.status,
      manualPayment: t.manualPayment,
      planPeriodicity: normalizePlanPeriod(t.planPeriodicity),
      currentPeriodEnd: t.currentPeriodEnd,
      suggestedAmount,
      suggestedCurrency: 'USD',
      payments,
    };
  }

  /**
   * Lista de revisión de cobranza manual: negocios que pagan POR FUERA
   * (manualPayment=true) cuyo ciclo ya venció y no tienen un ManualPayment
   * que cubra el ciclo vigente. Es la pantalla de "a estos hay que
   * perseguirlos o desconectarlos": el cron de mora NO los suspende solo.
   *
   * Incluye también los que nunca arrancaron ciclo (TRIAL vencido sin
   * currentPeriodEnd): el gate de suspensión también los salta, y si no
   * aparecieran acá quedarían invisibles para siempre.
   *
   * Aislamiento por marca: el middleware Prisma acota el findMany de Tenant
   * por `id IN (negocios de la marca)` en sesión de marca, y el de
   * ManualPayment por su tenantId — no hace falta filtro manual.
   */
  async listManualPaymentReview() {
    const now = new Date();
    const dayMs = 24 * 60 * 60 * 1000;
    // TODOS los marcados como "paga por fuera", no solo los vencidos.
    // Antes solo devolvía los vencidos y la pantalla salía vacía incluso con
    // negocios recién marcados: quien la abre espera ver a quién gestiona, no
    // una lista que casi siempre está en blanco. Los vencidos van primero.
    const tenants = await this.prisma.tenant.findMany({
      where: { manualPayment: true },
      select: {
        id: true,
        brandName: true,
        email: true,
        phone: true,
        status: true,
        planPeriodicity: true,
        currentPeriodEnd: true,
        trialEndsAt: true,
        whiteLabelId: true,
      },
    });
    if (tenants.length === 0) {
      return { count: 0, pendientes: 0, items: [] };
    }

    const pagos = await this.prisma.manualPayment.findMany({
      where: { tenantId: { in: tenants.map((t) => t.id) } },
      orderBy: { paidAt: 'desc' },
      select: {
        id: true,
        tenantId: true,
        method: true,
        amount: true,
        currency: true,
        paidAt: true,
        periodStart: true,
        periodEnd: true,
      },
    });
    const lastByTenant = new Map<string, (typeof pagos)[number]>();
    // Hasta cuándo lo deja cubierto el pago manual más lejano. Se usa incluso
    // si `currentPeriodEnd` quedó desincronizado: el pago registrado es el
    // hecho, la metadata puede estar vieja.
    const coveredUntil = new Map<string, Date>();
    for (const p of pagos) {
      if (!lastByTenant.has(p.tenantId)) lastByTenant.set(p.tenantId, p);
      const prev = coveredUntil.get(p.tenantId);
      if (!prev || p.periodEnd.getTime() > prev.getTime()) {
        coveredUntil.set(p.tenantId, p.periodEnd);
      }
    }

    const items = tenants.map((t) => {
      const cubierto = coveredUntil.get(t.id) ?? null;
      const hasta = cubierto ?? t.currentPeriodEnd ?? t.trialEndsAt ?? null;
      const vencido = !!hasta && hasta.getTime() < now.getTime();
      const estado = (
        t.status === 'SUSPENDED'
          ? 'DESCONECTADO'
          : vencido
            ? 'VENCIDO'
            : 'AL_DIA'
      ) as 'DESCONECTADO' | 'VENCIDO' | 'AL_DIA';
      const last = lastByTenant.get(t.id) ?? null;
      return {
        tenantId: t.id,
        brandName: t.brandName,
        email: t.email,
        phone: t.phone,
        status: t.status,
        whiteLabelId: t.whiteLabelId,
        planPeriodicity: normalizePlanPeriod(t.planPeriodicity),
        estado,
        /** Hasta cuándo está cubierto. Null = nunca arrancó ciclo. */
        coveredUntil: hasta,
        dueSince: vencido ? hasta : null,
        daysOverdue:
          vencido && hasta
            ? Math.max(0, Math.floor((now.getTime() - hasta.getTime()) / dayMs))
            : 0,
        reason: t.currentPeriodEnd
          ? ('CICLO_VENCIDO' as const)
          : ('TRIAL_VENCIDO' as const),
        lastManualPayment: last && {
          id: last.id,
          method: last.method,
          amount: last.amount,
          currency: last.currency,
          paidAt: last.paidAt,
          periodStart: last.periodStart,
          periodEnd: last.periodEnd,
        },
      };
    });
    // Vencidos primero (más días arriba), luego los que están al día por
    // cobertura más próxima: así la pantalla ordena el trabajo por sí sola.
    const orden = { VENCIDO: 0, AL_DIA: 1, DESCONECTADO: 2 };
    items.sort((a, b) => {
      if (orden[a.estado] !== orden[b.estado]) return orden[a.estado] - orden[b.estado];
      if (a.estado === 'VENCIDO') return b.daysOverdue - a.daysOverdue;
      return (a.coveredUntil?.getTime() ?? Infinity) - (b.coveredUntil?.getTime() ?? Infinity);
    });
    return {
      count: items.length,
      pendientes: items.filter((i) => i.estado === 'VENCIDO').length,
      items,
    };
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
    // 2026-06-26 (PDF 752 #5): los negocios de MARCA BLANCA NO reciben trial.
    // La marca debe ACTIVAR con créditos (1 crédito = activación), no con
    // pruebas gratis. Por eso el tope es 0 (trials bloqueados) SIEMPRE para
    // marcas no-Clubify no-ilimitadas, tengan o no créditos — los créditos
    // habilitan activar (marcar pagado/activo), no extender prueba.
    return 0;
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
        'Los negocios de marca blanca no usan prueba gratis. Actívalo con créditos: "Marcar como pagado" o "Marcar como activo" (consume 1 crédito).',
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
            appDomain: true,
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
            // Wallet V3 — permisos "Wallet Avanzado" de la marca (gating de las
            // funciones nuevas en la config de tarjetas y el escáner).
            walletAdvanced: true,
            // Planes de pago de la marca → el panel de suscripción del negocio
            // muestra el precio REAL de su marca (Sellea 80/799), no el de
            // Clubify. Host-independiente (funciona aunque el negocio esté en un
            // subdominio soyclubify.com).
            paymentGateway: true,
            paymentLinks: {
              where: { active: true },
              select: { periodicity: true, amountUsd: true, gateway: true, productKey: true, url: true },
            },
            // Academia — videos-tutorial ACTIVOS de la marca. El panel del
            // negocio los usa para mostrar el botón "▶ Ver tutorial" por módulo.
            academyVideos: {
              where: { active: true },
              select: { moduleKey: true, youtubeUrl: true, title: true, description: true },
            },
            modules: {
              where: { module: { in: ['REVIEWS', 'COMMUNITY', 'REFERRALS'] } },
              select: { module: true, enabled: true },
            },
          },
        },
        // Dominio personalizado del negocio (ej. birrialeon.com) → tiene
        // prioridad sobre el dominio de la marca para TODOS los links públicos
        // que el negocio comparte (infolink, QR, reservas). PDF 2026-07-25.
        storefront: { select: { customDomain: true } },
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
    const referralsModule = mods.find((m) => m.module === 'REFERRALS');
    return {
      ...t,
      whiteLabelCreditsUnlimited: t.whiteLabel?.creditsUnlimited ?? false,
      reviewsEnabled: reviewsModule ? reviewsModule.enabled : true,
      // Módulo REFERRALS de la marca. Un negocio de una marca blanca NO debe
      // ver "Referidos" si su marca lo tiene apagado (ej. Sellea). Marca con
      // registro = su flag; marca sin registro = false (oculto); sin marca
      // (legacy = Clubify, que lo tiene ON) = true. Espeja communityEnabled.
      referralsEnabled: t.whiteLabel
        ? (referralsModule?.enabled ?? false)
        : true,
      // Módulo COMMUNITY (Comunidad/Lab). Marca con registro = su flag; marca
      // sin registro de COMMUNITY = false (oculto). Sin marca (legacy) = true
      // (los negocios legacy son de Clubify, que sí tiene Comunidad).
      communityEnabled: t.whiteLabel
        ? (communityModule?.enabled ?? false)
        : true,
      // Wallet V3 — permisos "Wallet Avanzado" resueltos a 6 booleanos. null /
      // clave ausente / sin marca = true (heredado): las mejoras se activan para
      // todas las marcas salvo que una las apague explícitamente. El frontend
      // gatea la config de tarjetas y el escáner con estos flags.
      walletAdvanced: resolveWalletAdvanced(t.whiteLabel?.walletAdvanced),
      // Planes de la marca del negocio (precio real por periodicidad). Vacío
      // para Clubify / marca sin links → el panel cae al precio genérico.
      brandPlans:
        t.whiteLabel?.paymentLinks
          ?.filter(
            (l) => !t.whiteLabel?.paymentGateway || l.gateway === t.whiteLabel.paymentGateway,
          )
          .map((l) => ({
            periodicity: l.periodicity,
            amountUsd: l.amountUsd != null ? Number(l.amountUsd) : null,
          })) ?? [],
      // Academia — mapa { moduleKey: {youtubeUrl,title,description} } de videos
      // activos de la marca. El botón se muestra solo si el módulo está aquí.
      academyVideos: (t.whiteLabel?.academyVideos ?? []).reduce(
        (acc, v) => {
          if (v.youtubeUrl && v.youtubeUrl.trim()) {
            acc[v.moduleKey] = {
              youtubeUrl: v.youtubeUrl.trim(),
              title: v.title || '',
              description: v.description || '',
            };
          }
          return acc;
        },
        {} as Record<string, { youtubeUrl: string; title: string; description: string }>,
      ),
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
      // Dominio del panel/app de la marca (ej. app.selleala.com) → URL vanity
      // de InfoLinks. Cae a domain, y en última instancia a soyclubify.com.
      brandAppDomain: t.whiteLabel?.appDomain ?? null,
      // Dominio PROPIO del negocio (Storefront.customDomain, ej. birrialeon.com).
      // Máxima prioridad para los links públicos que comparte el negocio
      // (infolink/QR/reservas) y para el título de pestaña. null = sin dominio
      // propio → cae a la marca / soyclubify.com. Ver publicBaseForTenant().
      customDomain: t.storefront?.customDomain ?? null,
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
    if ('dataPolicyUrl' in data) {
      // PDF Software(8): "" o null → limpia el documento (cae al default
      // /legal/privacy). URL/PDF válido se trimea.
      const raw = data.dataPolicyUrl;
      data.dataPolicyUrl =
        typeof raw === 'string' && raw.trim().length > 0 ? raw.trim() : null;
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
