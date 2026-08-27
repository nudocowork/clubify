import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  BenefitCampaign,
  MembershipPlan,
  AllyStatus,
  PaymentGateway,
} from '@prisma/client';
import * as argon2 from 'argon2';
import { nanoid } from 'nanoid';
import { PrismaService } from '../common/prisma/prisma.service';
import { CardsService, CardDto } from '../cards/cards.service';
import { PassesService } from '../passes/passes.service';
import { LocationsService } from '../locations/locations.service';
import { actorOf, diffBenefit } from './benefit-history';
import {
  benefitPeriodStart,
  describeLimit,
  type BenefitLimitPeriod,
} from './benefit-limits';
import { NotificationsService } from '../notifications/notifications.service';
import { WalletService } from '../wallet/wallet.service';
import { AuthUser } from '../common/decorators/current-user.decorator';

/** Slug de la campaña (usado en el marketplace público /cuponera). */
const LIVING_CAMPAIGN_SLUG = 'living-card';
/** Slug del Tenant "de sistema" que respalda la campaña. Distinto del de la
 *  campaña para NO colisionar jamás con un negocio real. */
const SYSTEM_TENANT_SLUG = 'sys-living-card';

type EnrollInput = {
  fullName: string;
  /** Puede venir vacío si el pago llegó por una pasarela que no pide teléfono
   *  (Hotmart/Stripe). En ese caso se identifica al miembro por email. */
  phone: string;
  email?: string | null;
  planId?: string | null;
  /** Cuponera destino. Si falta, Living Card (comportamiento histórico). Lo
   *  manda el webhook: el plan comprado es el que decide la campaña, no el slug
   *  fijo — si no, comprar un plan de OTRA cuponera daba de alta en Living Card. */
  campaignId?: string | null;
  source?: 'MANUAL' | 'MERCADOPAGO' | 'HOTMART' | 'STRIPE' | 'FREE';
  mp?: { preapprovalId?: string; payerId?: string; expiresAt?: string | Date };
  /** Referencia recurrente de la pasarela (subscriberCode / subscription /
   *  preapproval). Es lo único que trae la cancelación para encontrar a quién
   *  dar de baja. */
  provider?: PaymentGateway | null;
  providerRef?: string | null;
  /** Vencimiento que dicta la pasarela (próxima fecha de cobro). Gana sobre el
   *  calculado a partir del intervalo del plan. */
  expiresAt?: string | Date | null;
};

/** Sede de un aliado (spec §5 y §9). Ver AllyLocationBody en cuponera.dto.ts. */
/** Alta de una cuponera desde el Master Admin de Fidelity (spec §2). */
export type CampaignCreateDto = {
  name?: string;
  slug?: string;
  /** OBLIGATORIO: la cuponera se vincula a una marca blanca existente. */
  whiteLabelId: string;
  description?: string;
  country?: string | null;
  city?: string | null;
  currency?: string | null;
  domain?: string | null;
  logoUrl?: string | null;
  coverUrl?: string | null;
  primaryColor?: string | null;
  secondaryColor?: string | null;
};

/** Edición de una cuponera. Todo opcional; el slug no se edita. */
export type CampaignUpdateDto = Partial<Omit<CampaignCreateDto, 'whiteLabelId' | 'slug'>> & {
  whiteLabelId?: string;
  status?: 'DRAFT' | 'ACTIVE' | 'PAUSED';
};

export type AllyLocationDto = {
  name?: string;
  address?: string;
  city?: string;
  latitude?: number | null;
  longitude?: number | null;
  radiusMeters?: number;
  geopushMessage?: string;
  geopushActive?: boolean;
  isActive?: boolean;
};

export type AllyProfileDto = {
  name?: string;
  description?: string;
  logoUrl?: string;
  coverUrl?: string;
  photos?: string[];
  address?: string;
  city?: string;
  latitude?: number | null;
  longitude?: number | null;
  hours?: Record<string, any>;
  whatsapp?: string;
  instagram?: string;
  website?: string;
};

export type BenefitType =
  | 'PERCENT_OFF'
  | 'AMOUNT_OFF'
  | 'TWO_FOR_ONE'
  | 'FREEBIE'
  | 'PRODUCT'
  | 'OTHER';

export type BenefitDto = {
  type?: BenefitType;
  title?: string;
  description?: string;
  imageUrl?: string;
  terms?: string;
  percentOff?: number | null;
  amountOffCents?: number | null;
  normalPriceCents?: number | null;
  memberPriceCents?: number | null;
  currency?: string;
  validFrom?: string | null;
  validUntil?: string | null;
  maxRedemptions?: number | null;
  maxPerMember?: number | null;
  status?: 'DRAFT' | 'ACTIVE' | 'PAUSED';
  categoryId?: string | null;
};

export type StampProgramDto = {
  name?: string;
  description?: string;
  imageUrl?: string;
  stampsRequired?: number;
  rewardText?: string;
  maxPerDay?: number;
  categoryId?: string | null;
  status?: 'ACTIVE' | 'PAUSED';
};

/**
 * Cuponera / Living Card (Fase 1). Orquesta la campaña de beneficios sobre un
 * Tenant "de sistema" (Tenant.isCampaignHost) para reusar TODO el stack Wallet:
 * el Card es la plantilla visual, cada miembro es un Customer y su tarjeta un
 * Pass normal (QR, push, geofence). NO confundir con `campaigns/` (afiliados).
 */
@Injectable()
export class CuponeraService {
  private logger = new Logger(CuponeraService.name);

  constructor(
    private prisma: PrismaService,
    private cards: CardsService,
    private passes: PassesService,
    private locations: LocationsService,
    private notifications: NotificationsService,
    private wallet: WalletService,
  ) {}

  // ---------------------------------------------------------------------------
  // Helpers de infraestructura (tenant de sistema, marca, plan gratis)
  // ---------------------------------------------------------------------------

  private _clubifyWlId: string | null | undefined;
  private async clubifyWlId(): Promise<string | null> {
    if (this._clubifyWlId !== undefined) return this._clubifyWlId;
    const wl = await this.prisma.whiteLabel.findFirst({
      where: { slug: 'clubify' },
      select: { id: true },
    });
    this._clubifyWlId = wl?.id ?? null;
    return this._clubifyWlId;
  }

  private async ensureFreePlan() {
    const existing = await this.prisma.plan.findUnique({
      where: { name: 'Sin plan' },
    });
    if (existing) return existing;
    return this.prisma.plan.create({
      data: { name: 'Sin plan', priceMonthly: 0, isActive: true },
    });
  }

  /** Usuario sintético SUPER_ADMIN para reusar CardsService (que scopea por
   *  rol/tenant). No corresponde a ninguna sesión real. */
  private sysUser(): AuthUser {
    return {
      id: 'system-cuponera',
      email: 'system@cuponera',
      role: 'SUPER_ADMIN',
      tenantId: null,
      whiteLabelId: null,
    };
  }

  /** Crea/recupera el Tenant de sistema que respalda la campaña. */
  private async ensureSystemTenant(name: string) {
    const existing = await this.prisma.tenant.findUnique({
      where: { slug: SYSTEM_TENANT_SLUG },
    });
    if (existing) {
      if (!existing.isCampaignHost) {
        await this.prisma.tenant.update({
          where: { id: existing.id },
          data: { isCampaignHost: true },
        });
      }
      return existing;
    }
    const plan = await this.ensureFreePlan();
    const wlId = await this.clubifyWlId();
    return this.prisma.tenant.create({
      data: {
        name,
        brandName: name,
        slug: SYSTEM_TENANT_SLUG,
        email: 'campaign+living-card@clubify.app',
        planId: plan.id,
        whiteLabelId: wlId,
        status: 'ACTIVE',
        isCampaignHost: true,
        hotmartSubscriberCode: `campaign-${SYSTEM_TENANT_SLUG}`,
        primaryColor: '#0a90bd',
        secondaryColor: '#075e7d',
      },
    });
  }

  // ---------------------------------------------------------------------------
  // CUPONERAS (spec §1 y §2) — el Master Admin de Fidelity administra VARIAS.
  //
  // Ojo con la jerarquía: Fidelity es el Master Admin; Clubify es UNA marca
  // blanca más. Cada cuponera se vincula a la marca blanca que corresponda, y
  // por eso `whiteLabelId` es obligatorio al crearla: sin él la cuponera queda
  // colgando de la nada y el aliado Tipo A nunca podría resolverse.
  //
  // Cada cuponera tiene su PROPIO tenant de sistema (isCampaignHost=true), que
  // es lo que le da su stack de Wallet sin reescribir nada.
  // ---------------------------------------------------------------------------

  /** Todas las cuponeras con su marca blanca y sus conteos (§1). */
  async listCampaigns() {
    const campaigns = await this.prisma.benefitCampaign.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        whiteLabel: { select: { id: true, name: true, slug: true } },
        _count: {
          select: { allies: true, memberships: true, benefits: true, redemptions: true },
        },
      },
    });
    return campaigns.map((c) => ({
      id: c.id,
      name: c.name,
      slug: c.slug,
      status: c.status,
      whiteLabel: c.whiteLabel,
      createdAt: c.createdAt,
      counts: {
        allies: c._count.allies,
        members: c._count.memberships,
        benefits: c._count.benefits,
        redemptions: c._count.redemptions,
      },
    }));
  }

  /** Crea una cuponera + su tenant de sistema (§2). */
  async createCampaign(dto: CampaignCreateDto) {
    const name = (dto.name ?? '').trim();
    if (!name) throw new BadRequestException('La cuponera necesita un nombre');

    // La slugify del servicio cae a 'cat' cuando no queda nada (viene de
    // categorías). Para una cuponera eso daría un slug absurdo en silencio, así
    // que se valida ANTES que haya algo alfanumérico.
    const raw = (dto.slug || name).normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    if (!/[a-z0-9]/i.test(raw)) throw new BadRequestException('Slug inválido');
    const slug = this.slugify(raw);

    const dup = await this.prisma.benefitCampaign.findUnique({ where: { slug } });
    if (dup) throw new BadRequestException(`Ya existe una cuponera con el slug "${slug}"`);

    // La marca blanca tiene que EXISTIR: si no, la cuponera queda huérfana y
    // ningún aliado Tipo A podría vincularse.
    const wl = await this.prisma.whiteLabel.findUnique({
      where: { id: dto.whiteLabelId },
      select: { id: true },
    });
    if (!wl) throw new BadRequestException('La marca blanca no existe');

    const tenant = await this.ensureCampaignTenant(`sys-${slug}`, name, wl.id);
    return this.prisma.benefitCampaign.create({
      data: {
        whiteLabelId: wl.id,
        tenantId: tenant.id,
        name,
        slug,
        status: 'DRAFT', // nace apagada: se publica cuando está cargada
        welcomeText: (dto.description ?? `Bienvenido a ${name}`).trim(),
        config: {
          country: dto.country ?? null,
          city: dto.city ?? null,
          currency: dto.currency ?? 'COP',
          domain: dto.domain ?? null,
          logoUrl: dto.logoUrl ?? null,
          coverUrl: dto.coverUrl ?? null,
          primaryColor: dto.primaryColor ?? null,
          secondaryColor: dto.secondaryColor ?? null,
        },
      },
      include: { whiteLabel: { select: { id: true, name: true, slug: true } } },
    });
  }

  /**
   * Edita la ficha de UNA cuponera por id (§2). El slug NO se toca: cuelga de
   * URLs vivas. Distinta de `updateCampaign(dto)`, que edita la campaña única
   * de Living Card y se mantiene por compatibilidad.
   */
  async updateCampaignById(id: string, dto: CampaignUpdateDto) {
    const campaign = await this.prisma.benefitCampaign.findUnique({ where: { id } });
    if (!campaign) throw new NotFoundException('Cuponera no encontrada');

    if (dto.whiteLabelId !== undefined) {
      const wl = await this.prisma.whiteLabel.findUnique({
        where: { id: dto.whiteLabelId },
        select: { id: true },
      });
      if (!wl) throw new BadRequestException('La marca blanca no existe');
    }

    const cfg = (campaign.config ?? {}) as Record<string, unknown>;
    const keys = [
      'country', 'city', 'currency', 'domain',
      'logoUrl', 'coverUrl', 'primaryColor', 'secondaryColor',
    ] as const;
    for (const k of keys) if (dto[k] !== undefined) cfg[k] = dto[k];

    return this.prisma.benefitCampaign.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.description !== undefined ? { welcomeText: dto.description.trim() } : {}),
        ...(dto.whiteLabelId !== undefined ? { whiteLabelId: dto.whiteLabelId } : {}),
        ...(dto.status !== undefined ? { status: dto.status } : {}),
        config: cfg as any,
      },
      include: { whiteLabel: { select: { id: true, name: true, slug: true } } },
    });
  }

  // ---------------------------------------------------------------------------
  // PANEL DE LA CUPONERA (spec §4)
  //
  // Consultas propias, TODAS scopeadas por campaignId. No se reusan los métodos
  // del panel de Fidelity porque esos llaman `ensureLivingCampaign()` por
  // dentro (48 sitios): a un admin de otra cuponera le mostrarían Living Card.
  // Parametrizar esos 48 es un refactor aparte; mientras tanto el panel tiene
  // sus propias lecturas y no depende de ellos.
  //
  // La campaña SIEMPRE sale de `resolveAdminCampaign`, nunca de un id del
  // cliente: es lo que impide que un admin mire la cuponera de otro.
  // ---------------------------------------------------------------------------

  /** Números de la pantalla inicial del panel (§4). */
  async panelOverview(user: AuthUser, campaignId?: string) {
    const campaign = await this.resolveAdminCampaign(user, campaignId);
    const cid = campaign.id;
    const monthStart = benefitPeriodStart('MONTH', new Date())!;

    const [
      members, activeMembers, allies, activeAllies,
      benefits, redemptionsMonth, redemptionsTotal, walletCards,
    ] = await Promise.all([
      this.prisma.livingMembership.count({ where: { campaignId: cid } }),
      this.prisma.livingMembership.count({ where: { campaignId: cid, status: 'ACTIVE' } }),
      this.prisma.allyBusiness.count({ where: { campaignId: cid } }),
      this.prisma.allyBusiness.count({ where: { campaignId: cid, status: 'APPROVED' } }),
      this.prisma.benefit.count({
        where: { campaignId: cid, status: 'ACTIVE', approval: 'APPROVED' },
      }),
      this.prisma.redemption.count({ where: { campaignId: cid, createdAt: { gte: monthStart } } }),
      this.prisma.redemption.count({ where: { campaignId: cid } }),
      // Tarjeta emitida = membresía con su pase creado.
      this.prisma.livingMembership.count({ where: { campaignId: cid, passId: { not: null } } }),
    ]);

    // Rankings: se agrupan los canjes y después se traen los nombres, para no
    // pedirle a Postgres un join que Prisma no expresa en groupBy.
    const [topBenefits, topAllies] = await Promise.all([
      this.prisma.redemption.groupBy({
        by: ['benefitId'],
        where: { campaignId: cid },
        _count: { benefitId: true },
        orderBy: { _count: { benefitId: 'desc' } },
        take: 5,
      }),
      this.prisma.redemption.groupBy({
        by: ['allyBusinessId'],
        where: { campaignId: cid },
        _count: { allyBusinessId: true },
        orderBy: { _count: { allyBusinessId: 'desc' } },
        take: 5,
      }),
    ]);

    const [benefitNames, allyNames] = await Promise.all([
      topBenefits.length
        ? this.prisma.benefit.findMany({
            where: { id: { in: topBenefits.map((b) => b.benefitId) } },
            select: { id: true, title: true },
          })
        : [],
      topAllies.length
        ? this.prisma.allyBusiness.findMany({
            where: { id: { in: topAllies.map((a) => a.allyBusinessId) } },
            select: { id: true, name: true },
          })
        : [],
    ]);
    const bName = new Map(benefitNames.map((b) => [b.id, b.title]));
    const aName = new Map(allyNames.map((a) => [a.id, a.name]));

    return {
      campaign: { id: cid, name: campaign.name, slug: campaign.slug, status: campaign.status },
      counts: {
        members,
        activeMembers,
        allies,
        activeAllies,
        benefits,
        redemptionsMonth,
        redemptionsTotal,
        walletCards,
      },
      topBenefits: topBenefits.map((b) => ({
        id: b.benefitId,
        title: bName.get(b.benefitId) ?? '(eliminado)',
        redemptions: b._count.benefitId,
      })),
      topAllies: topAllies.map((a) => ({
        id: a.allyBusinessId,
        name: aName.get(a.allyBusinessId) ?? '(eliminado)',
        redemptions: a._count.allyBusinessId,
      })),
    };
  }

  /** Aliados de la cuponera del admin (§4 → Aliados). */
  async panelAllies(user: AuthUser, campaignId?: string) {
    const campaign = await this.resolveAdminCampaign(user, campaignId);
    return this.prisma.allyBusiness.findMany({
      where: { campaignId: campaign.id },
      include: {
        category: { select: { id: true, name: true } },
        _count: { select: { benefits: true, redemptions: true, locations: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });
  }

  /** Beneficiarios (§4 → Beneficiarios). */
  async panelMembers(user: AuthUser, campaignId?: string) {
    const campaign = await this.resolveAdminCampaign(user, campaignId);
    return this.prisma.livingMembership.findMany({
      where: { campaignId: campaign.id },
      include: {
        customer: { select: { id: true, fullName: true, phone: true, email: true } },
        plan: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });
  }

  /** Historial de canjes (§4 → Redenciones). Incluye la sede (§19). */
  async panelRedemptions(user: AuthUser, campaignId?: string) {
    const campaign = await this.resolveAdminCampaign(user, campaignId);
    return this.prisma.redemption.findMany({
      where: { campaignId: campaign.id },
      include: {
        benefit: { select: { id: true, title: true } },
        ally: { select: { id: true, name: true } },
        location: { select: { id: true, name: true } },
        customer: { select: { id: true, fullName: true, phone: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });
  }

  /**
   * Crea el ADMINISTRADOR de una cuponera (spec §3). NO entra al Master Admin
   * de Fidelity: su rol es CUPONERA_ADMIN y solo ve el panel de SU cuponera.
   *
   * Sin tenantId a propósito — una cuponera no es un negocio. El scope sale de
   * `User.campaignId`, igual que ALLY_BUSINESS lo saca de allyBusinessId.
   */
  async createCampaignAdmin(
    campaignId: string,
    dto: { email: string; fullName: string; password?: string },
  ) {
    const campaign = await this.prisma.benefitCampaign.findUnique({
      where: { id: campaignId },
      select: { id: true, name: true },
    });
    if (!campaign) throw new NotFoundException('Cuponera no encontrada');

    const email = (dto.email ?? '').trim().toLowerCase();
    if (!email.includes('@')) throw new BadRequestException('Email inválido');
    const fullName = (dto.fullName ?? '').trim();
    if (!fullName) throw new BadRequestException('El administrador necesita un nombre');

    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) throw new BadRequestException('Ya existe un usuario con ese email');

    // Si no mandan clave se genera una y se devuelve UNA sola vez: queda
    // hasheada, no hay forma de recuperarla después.
    const tempPassword = dto.password || nanoid(10);
    const passwordHash = await argon2.hash(tempPassword);

    const user = await this.prisma.user.create({
      data: {
        email,
        passwordHash,
        fullName,
        role: 'CUPONERA_ADMIN',
        campaignId: campaign.id,
      },
      select: { id: true, email: true, fullName: true, role: true, campaignId: true },
    });

    return {
      admin: user,
      campaign: { id: campaign.id, name: campaign.name },
      loginEmail: email,
      tempPassword: dto.password ? undefined : tempPassword,
    };
  }

  /**
   * Negocios elegibles como aliado TIPO A (§16). Excluye los tenants de sistema
   * y los que YA son aliados de esta cuponera: un negocio no puede serlo dos
   * veces, y ofrecerlo llevaría a un choque al guardar.
   */
  async listTenantsForAlly() {
    const campaign = await this.ensureLivingCampaign();
    const yaAliados = await this.prisma.allyBusiness.findMany({
      where: { campaignId: campaign.id, tenantId: { not: null } },
      select: { tenantId: true },
    });
    const excluir = yaAliados.map((a) => a.tenantId as string);
    return this.prisma.tenant.findMany({
      where: {
        isCampaignHost: false,
        status: 'ACTIVE',
        ...(campaign.whiteLabelId ? { whiteLabelId: campaign.whiteLabelId } : {}),
        ...(excluir.length ? { id: { notIn: excluir } } : {}),
      },
      select: { id: true, name: true, brandName: true, slug: true },
      orderBy: { name: 'asc' },
      take: 500,
    });
  }

  /** Administradores de una cuponera (§3). Nunca devuelve el hash. */
  async listCampaignAdmins(campaignId: string) {
    return this.prisma.user.findMany({
      where: { campaignId, role: 'CUPONERA_ADMIN' },
      select: { id: true, email: true, fullName: true, isActive: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    });
  }

  /**
   * Cuponera del usuario logueado. Para CUPONERA_ADMIN sale de su `campaignId`;
   * PLATFORM_OWNER/SUPER_ADMIN pueden pedir cualquiera por id (spec §1: "entrar
   * administrativamente a cualquier cuponera").
   */
  async resolveAdminCampaign(user: AuthUser, requestedId?: string) {
    if (user.role === 'CUPONERA_ADMIN') {
      if (!user.campaignId) throw new ForbiddenException('Sesión sin cuponera');
      // Un admin de cuponera NO puede mirar otra pidiéndola por id.
      if (requestedId && requestedId !== user.campaignId) {
        throw new ForbiddenException('Esa cuponera no es tuya');
      }
      const c = await this.prisma.benefitCampaign.findUnique({ where: { id: user.campaignId } });
      if (!c) throw new NotFoundException('Cuponera no encontrada');
      return c;
    }
    if (requestedId) {
      const c = await this.prisma.benefitCampaign.findUnique({ where: { id: requestedId } });
      if (!c) throw new NotFoundException('Cuponera no encontrada');
      return c;
    }
    return this.ensureLivingCampaign();
  }

  /**
   * Tenant de sistema de UNA cuponera. Versión parametrizada de
   * ensureSystemTenant, que estaba clavada al slug de Living Card.
   */
  private async ensureCampaignTenant(slug: string, name: string, whiteLabelId: string) {
    const existing = await this.prisma.tenant.findUnique({ where: { slug } });
    if (existing) {
      if (!existing.isCampaignHost) {
        await this.prisma.tenant.update({
          where: { id: existing.id },
          data: { isCampaignHost: true },
        });
      }
      return existing;
    }
    const plan = await this.ensureFreePlan();
    return this.prisma.tenant.create({
      data: {
        name,
        brandName: name,
        slug,
        email: `campaign+${slug}@clubify.app`,
        planId: plan.id,
        whiteLabelId,
        status: 'ACTIVE',
        isCampaignHost: true,
        hotmartSubscriberCode: `campaign-${slug}`,
        primaryColor: '#0a90bd',
        secondaryColor: '#075e7d',
      },
    });
  }

  // ---------------------------------------------------------------------------
  // Campaña + tarjeta
  // ---------------------------------------------------------------------------

  /** Idempotente: crea la campaña Living Card (y su tenant de sistema) si no
   *  existe todavía. Es el punto de entrada de casi todo. */
  async ensureLivingCampaign(): Promise<BenefitCampaign> {
    const existing = await this.prisma.benefitCampaign.findUnique({
      where: { slug: LIVING_CAMPAIGN_SLUG },
    });
    if (existing) return existing;

    const tenant = await this.ensureSystemTenant('Living Card');
    const wlId = await this.clubifyWlId();
    return this.prisma.benefitCampaign.create({
      data: {
        whiteLabelId: wlId,
        tenantId: tenant.id,
        name: 'Living Card',
        slug: LIVING_CAMPAIGN_SLUG,
        status: 'DRAFT',
        welcomeText: 'Bienvenido a Living Card',
      },
    });
  }

  /** Asegura que exista la tarjeta Wallet (plantilla) de la campaña. Si el
   *  admin aún no la diseñó, crea una MEMBERSHIP mínima con la marca de la
   *  campaña para poder emitir pases desde ya. */
  private async ensureLivingCard(campaign: BenefitCampaign) {
    if (campaign.cardId) {
      const c = await this.prisma.card.findUnique({
        where: { id: campaign.cardId },
      });
      if (c) return c;
    }
    const card = await this.cards.create(
      this.sysUser(),
      {
        type: 'MEMBERSHIP',
        name: campaign.name,
        businessName: campaign.name,
        walletBrandName: campaign.name,
        primaryColor: '#0a90bd',
        secondaryColor: '#075e7d',
        rewardText: 'Beneficios exclusivos para miembros',
        tiers: [{ name: 'Miembro', threshold: 0 }],
        tierMetric: 'stamps',
      } as CardDto,
      campaign.tenantId,
    );
    await this.prisma.benefitCampaign.update({
      where: { id: campaign.id },
      data: { cardId: card.id },
    });
    return card;
  }

  /** Diseña (crea o actualiza) la tarjeta Wallet de la campaña. Reusa
   *  CardsService.update → encola wallet.push a todos los pases activos. */
  async designCard(dto: CardDto) {
    const campaign = await this.ensureLivingCampaign();
    if (campaign.cardId) {
      const existing = await this.prisma.card.findUnique({
        where: { id: campaign.cardId },
      });
      if (existing) return this.cards.update(this.sysUser(), campaign.cardId, dto);
    }
    const card = await this.cards.create(this.sysUser(), dto, campaign.tenantId);
    await this.prisma.benefitCampaign.update({
      where: { id: campaign.id },
      data: { cardId: card.id },
    });
    return card;
  }

  /** Estado completo para el panel Master Admin. */
  async getCampaignAdmin() {
    const campaign = await this.ensureLivingCampaign();
    const [card, plans, categories] = await Promise.all([
      campaign.cardId
        ? this.prisma.card.findUnique({ where: { id: campaign.cardId } })
        : null,
      this.prisma.membershipPlan.findMany({
        where: { campaignId: campaign.id },
        orderBy: { sortOrder: 'asc' },
      }),
      this.prisma.benefitCategory.findMany({
        where: { campaignId: campaign.id },
        orderBy: { sortOrder: 'asc' },
      }),
    ]);
    const cfg = (campaign.config as any) || {};
    return {
      campaign: {
        id: campaign.id,
        name: campaign.name,
        slug: campaign.slug,
        status: campaign.status,
        welcomeText: campaign.welcomeText,
        cardId: campaign.cardId,
        marketplace: cfg.marketplace ?? {},
        mpConfigured: !!cfg.mp?.accessToken,
      },
      card,
      plans,
      categories,
    };
  }

  async updateCampaign(dto: {
    name?: string;
    welcomeText?: string;
    status?: 'DRAFT' | 'ACTIVE' | 'PAUSED';
    marketplace?: Record<string, any>;
  }) {
    const campaign = await this.ensureLivingCampaign();
    if (dto.status === 'ACTIVE') await this.ensureLivingCard(campaign);
    const cfg = ((campaign.config as any) || {}) as Record<string, any>;
    if (dto.marketplace) cfg.marketplace = { ...(cfg.marketplace || {}), ...dto.marketplace };
    return this.prisma.benefitCampaign.update({
      where: { id: campaign.id },
      data: {
        name: dto.name ?? undefined,
        welcomeText: dto.welcomeText ?? undefined,
        status: dto.status ?? undefined,
        config: cfg as any,
      },
    });
  }

  // ---------------------------------------------------------------------------
  // Planes de membresía
  // ---------------------------------------------------------------------------

  async listPlans() {
    const campaign = await this.ensureLivingCampaign();
    return this.prisma.membershipPlan.findMany({
      where: { campaignId: campaign.id },
      orderBy: { sortOrder: 'asc' },
    });
  }

  async createPlan(dto: {
    name: string;
    priceCents: number;
    currency?: string;
    interval?: 'MONTHLY' | 'ANNUAL';
    level?: number;
    benefitsAllowance?: number | null;
    description?: string;
    sortOrder?: number;
    isActive?: boolean;
    /** Mapeo a las pasarelas (spec §24). Ver PlanBody en el controller. */
    hotmartProductId?: string | null;
    hotmartOfferCode?: string | null;
    stripePriceId?: string | null;
    hotmartCheckoutUrl?: string | null;
    stripeCheckoutUrl?: string | null;
  }) {
    const campaign = await this.ensureLivingCampaign();
    return this.prisma.membershipPlan.create({
      data: {
        campaignId: campaign.id,
        name: dto.name,
        priceCents: Math.max(0, Math.round(dto.priceCents || 0)),
        currency: dto.currency || 'COP',
        interval: dto.interval || 'MONTHLY',
        level: dto.level ?? 0,
        benefitsAllowance: dto.benefitsAllowance ?? null,
        description: dto.description || '',
        sortOrder: dto.sortOrder ?? 0,
        ...this.mapeoPasarelas(dto),
        isActive: dto.isActive ?? true,
      },
    });
  }

  async updatePlan(id: string, dto: Partial<Parameters<CuponeraService['createPlan']>[0]>) {
    const campaign = await this.ensureLivingCampaign();
    await this.assertPlan(campaign.id, id);
    return this.prisma.membershipPlan.update({
      where: { id },
      data: {
        name: dto.name ?? undefined,
        priceCents:
          dto.priceCents != null ? Math.max(0, Math.round(dto.priceCents)) : undefined,
        currency: dto.currency ?? undefined,
        interval: dto.interval ?? undefined,
        level: dto.level ?? undefined,
        benefitsAllowance:
          dto.benefitsAllowance === undefined ? undefined : dto.benefitsAllowance,
        description: dto.description ?? undefined,
        sortOrder: dto.sortOrder ?? undefined,
        isActive: dto.isActive ?? undefined,
        ...this.mapeoPasarelas(dto),
      },
    });
  }

  /**
   * Normaliza el mapeo producto-de-pasarela → plan (spec §24). Cadena vacía se
   * guarda como null a propósito: '' en hotmartProductId haría que el webhook
   * buscara por '' y no matcheara nunca, que es un bug silencioso y caro.
   * `undefined` (campo no enviado) no toca la columna.
   */
  private mapeoPasarelas(dto: {
    hotmartProductId?: string | null;
    hotmartOfferCode?: string | null;
    stripePriceId?: string | null;
    hotmartCheckoutUrl?: string | null;
    stripeCheckoutUrl?: string | null;
  }) {
    const limpio = (v: string | null | undefined) =>
      v === undefined ? undefined : v?.trim() || null;
    return {
      hotmartProductId: limpio(dto.hotmartProductId),
      hotmartOfferCode: limpio(dto.hotmartOfferCode),
      stripePriceId: limpio(dto.stripePriceId),
      hotmartCheckoutUrl: limpio(dto.hotmartCheckoutUrl),
      stripeCheckoutUrl: limpio(dto.stripeCheckoutUrl),
    };
  }

  /**
   * Estado de las pasarelas de la cuponera (spec §24-25): qué URL hay que pegar
   * en el panel de cada proveedor y qué planes están mapeados. Sin esta pantalla
   * el mapeo se configura a ciegas.
   */
  async gatewaysStatus(campaignId?: string) {
    const campaign = campaignId
      ? await this.prisma.benefitCampaign.findUnique({ where: { id: campaignId } })
      : await this.ensureLivingCampaign();
    if (!campaign) throw new NotFoundException('Cuponera no encontrada');

    const api = (process.env.API_PUBLIC_URL || 'https://api.soyclubify.com').replace(/\/+$/, '');
    const planes = await this.prisma.membershipPlan.findMany({
      where: { campaignId: campaign.id },
      orderBy: { sortOrder: 'asc' },
    });

    const conHotmart = planes.filter((p) => p.hotmartProductId).length;
    const conStripe = planes.filter((p) => p.stripePriceId).length;

    // Hotmart y Stripe entran por la ruta POR MARCA, no por la de la cuponera:
    // el cobro lo recibe la cuenta de la marca blanca dueña de la cuponera, y
    // esa ruta ya valida el hottok / la firma contra las credenciales de la
    // marca. MercadoPago sí es por cuponera porque sus credenciales viven en la
    // config de la campaña.
    return {
      campaign: { id: campaign.id, slug: campaign.slug, name: campaign.name },
      hotmart: {
        webhookUrl: `${api}/api/webhooks/hotmart/<slug-de-la-marca>`,
        planesMapeados: conHotmart,
        listo: conHotmart > 0,
      },
      stripe: {
        webhookUrl: `${api}/api/webhooks/stripe/<slug-de-la-marca>`,
        planesMapeados: conStripe,
        listo: conStripe > 0,
      },
      mercadopago: {
        webhookUrl: `${api}/api/webhooks/mercadopago/${campaign.slug}`,
        configurado: !!(campaign.config as any)?.mp?.accessToken,
      },
      planes: planes.map((p) => ({
        id: p.id,
        name: p.name,
        priceCents: p.priceCents,
        currency: p.currency,
        interval: p.interval,
        isActive: p.isActive,
        hotmartProductId: p.hotmartProductId,
        hotmartOfferCode: p.hotmartOfferCode,
        stripePriceId: p.stripePriceId,
        hotmartCheckoutUrl: p.hotmartCheckoutUrl,
        stripeCheckoutUrl: p.stripeCheckoutUrl,
      })),
    };
  }

  async deletePlan(id: string) {
    const campaign = await this.ensureLivingCampaign();
    await this.assertPlan(campaign.id, id);
    await this.prisma.membershipPlan.delete({ where: { id } });
    return { ok: true };
  }

  private async assertPlan(campaignId: string, id: string) {
    const plan = await this.prisma.membershipPlan.findFirst({
      where: { id, campaignId },
    });
    if (!plan) throw new NotFoundException('Plan no encontrado');
    return plan;
  }

  // ---------------------------------------------------------------------------
  // Categorías de beneficios
  // ---------------------------------------------------------------------------

  async listCategories() {
    const campaign = await this.ensureLivingCampaign();
    return this.prisma.benefitCategory.findMany({
      where: { campaignId: campaign.id },
      orderBy: { sortOrder: 'asc' },
    });
  }

  async createCategory(dto: { name: string; icon?: string; sortOrder?: number }) {
    const campaign = await this.ensureLivingCampaign();
    const slug = this.slugify(dto.name);
    return this.prisma.benefitCategory.create({
      data: {
        campaignId: campaign.id,
        name: dto.name,
        slug,
        icon: dto.icon || '',
        sortOrder: dto.sortOrder ?? 0,
      },
    });
  }

  async updateCategory(
    id: string,
    dto: { name?: string; icon?: string; sortOrder?: number; isActive?: boolean },
  ) {
    const campaign = await this.ensureLivingCampaign();
    const cat = await this.prisma.benefitCategory.findFirst({
      where: { id, campaignId: campaign.id },
    });
    if (!cat) throw new NotFoundException('Categoría no encontrada');
    return this.prisma.benefitCategory.update({
      where: { id },
      data: {
        name: dto.name ?? undefined,
        slug: dto.name ? this.slugify(dto.name) : undefined,
        icon: dto.icon ?? undefined,
        sortOrder: dto.sortOrder ?? undefined,
        isActive: dto.isActive ?? undefined,
      },
    });
  }

  async deleteCategory(id: string) {
    const campaign = await this.ensureLivingCampaign();
    const cat = await this.prisma.benefitCategory.findFirst({
      where: { id, campaignId: campaign.id },
    });
    if (!cat) throw new NotFoundException('Categoría no encontrada');
    await this.prisma.benefitCategory.delete({ where: { id } });
    return { ok: true };
  }

  // ---------------------------------------------------------------------------
  // Miembros (alta manual + emisión de tarjeta)
  // ---------------------------------------------------------------------------

  private computeExpiry(
    plan: MembershipPlan | null,
    override?: string | Date | null,
  ): Date | null {
    if (override) return new Date(override);
    if (!plan) return null;
    // Un plan gratuito NO vence. Sin este corte, el intervalo del plan le
    // pondría vencimiento a un mes y el candado de canje apagaría al mes a
    // alguien que se unió gratis y para siempre (spec §23).
    if (plan.priceCents <= 0) return null;
    const d = new Date();
    if (plan.interval === 'ANNUAL') d.setFullYear(d.getFullYear() + 1);
    else d.setMonth(d.getMonth() + 1);
    return d;
  }

  /** Da de alta (o reactiva) un miembro y le emite su tarjeta Living Card.
   *  Usado tanto por el alta MANUAL (Master Admin) como por el pago (MP). */
  async enrollMember(input: EnrollInput) {
    // La campaña la decide el plan comprado, no un slug fijo. Sin campaignId
    // seguimos cayendo en Living Card, que es lo que hacía siempre.
    const campaign = input.campaignId
      ? await this.prisma.benefitCampaign.findUnique({ where: { id: input.campaignId } })
      : await this.ensureLivingCampaign();
    if (!campaign) throw new NotFoundException('Cuponera no encontrada');
    const card = await this.ensureLivingCard(campaign);
    const tenantId = campaign.tenantId;

    const phoneNorm = (input.phone || '').replace(/\s/g, '').trim();
    const digits = phoneNorm.replace(/\D/g, '');
    const email = input.email?.trim().toLowerCase() || null;
    const tienePhone = digits.length >= 8;
    // Hotmart y Stripe no siempre mandan teléfono; el email sí viene siempre.
    // Con uno de los dos alcanza — sin ninguno no hay a quién dar de alta.
    if (!tienePhone && !email) {
      throw new BadRequestException('Hace falta teléfono o email para dar de alta al miembro');
    }
    const last10 = digits.slice(-10);

    // Match-or-create Customer del tenant de sistema: teléfono exacto, luego
    // últimos 10 dígitos (tolera formatos), y por último email. El orden importa:
    // el teléfono es la identidad fuerte; el email solo se usa si no hay otra.
    let customer = tienePhone
      ? await this.prisma.customer
          .findUnique({ where: { tenantId_phone: { tenantId, phone: phoneNorm } } })
          .catch(() => null)
      : null;
    if (!customer && tienePhone && last10.length >= 8) {
      customer = await this.prisma.customer.findFirst({
        where: { tenantId, phone: { contains: last10 } },
      });
    }
    if (!customer && email) {
      customer = await this.prisma.customer.findFirst({
        where: { tenantId, email },
        orderBy: { createdAt: 'asc' },
      });
    }
    if (!customer) {
      customer = await this.prisma.customer.create({
        data: {
          tenantId,
          fullName: input.fullName,
          phone: tienePhone ? phoneNorm : null,
          email,
        },
      });
    } else if (tienePhone && !customer.phone) {
      // El miembro compró sin teléfono y ahora lo tenemos: completarlo, porque
      // de él dependen el SMS/WhatsApp y la búsqueda "mi tarjeta por teléfono".
      customer = await this.prisma.customer.update({
        where: { id: customer.id },
        data: { phone: phoneNorm },
      });
    }

    const plan = input.planId
      ? await this.prisma.membershipPlan.findFirst({
          where: { id: input.planId, campaignId: campaign.id },
        })
      : null;
    const expiresAt = this.computeExpiry(
      plan,
      input.expiresAt ?? input.mp?.expiresAt ?? undefined,
    );

    // Emite el pase (idempotente por [cardId, customerId]) → dispara PASS_CREATED.
    const pass = await this.passes.issueInternal(card.id, customer.id);

    const membership = await this.prisma.livingMembership.upsert({
      where: {
        campaignId_customerId: { campaignId: campaign.id, customerId: customer.id },
      },
      update: {
        planId: plan?.id ?? undefined,
        status: 'ACTIVE',
        source: input.source ?? 'MANUAL',
        memberLevel: plan?.level ?? 0,
        activatedAt: new Date(),
        expiresAt,
        passId: pass.id,
        ...(input.mp?.preapprovalId ? { mpPreapprovalId: input.mp.preapprovalId } : {}),
        ...(input.mp?.payerId ? { mpPayerId: input.mp.payerId } : {}),
        ...(input.provider ? { provider: input.provider } : {}),
        ...(input.providerRef ? { providerRef: input.providerRef } : {}),
      },
      create: {
        campaignId: campaign.id,
        customerId: customer.id,
        planId: plan?.id ?? null,
        status: 'ACTIVE',
        source: input.source ?? 'MANUAL',
        memberLevel: plan?.level ?? 0,
        activatedAt: new Date(),
        expiresAt,
        passId: pass.id,
        mpPreapprovalId: input.mp?.preapprovalId ?? null,
        mpPayerId: input.mp?.payerId ?? null,
        provider: input.provider ?? null,
        providerRef: input.providerRef ?? null,
      },
    });

    return {
      membershipId: membership.id,
      customerId: customer.id,
      passId: pass.id,
      status: membership.status,
    };
  }

  /**
   * Alta sin pago de una cuponera gratuita (spec §23: "El usuario se registra y
   * obtiene acceso"). Endpoint PÚBLICO, así que las guardas son el producto:
   *
   *  · El plan tiene que costar 0. Si no, esto sería una puerta para saltarse
   *    el pago de un plan pago con solo mandar su id.
   *  · La cuponera tiene que estar ACTIVE. Una en DRAFT todavía no existe para
   *    el público y no debería juntar miembros.
   */
  async joinFree(dto: {
    fullName: string;
    phone?: string;
    email?: string;
    planId?: string;
    campaignId?: string;
  }) {
    const campaign = dto.campaignId
      ? await this.prisma.benefitCampaign.findUnique({ where: { id: dto.campaignId } })
      : await this.ensureLivingCampaign();
    if (!campaign) throw new NotFoundException('Cuponera no encontrada');
    if (campaign.status !== 'ACTIVE') {
      throw new BadRequestException('Esta cuponera todavía no está abierta al público.');
    }

    const plan = dto.planId
      ? await this.prisma.membershipPlan.findFirst({
          where: { id: dto.planId, campaignId: campaign.id, isActive: true },
        })
      : await this.prisma.membershipPlan.findFirst({
          where: { campaignId: campaign.id, isActive: true, priceCents: 0 },
          orderBy: { sortOrder: 'asc' },
        });
    if (!plan) throw new NotFoundException('Plan no encontrado');
    if (plan.priceCents > 0) {
      throw new BadRequestException('Este plan es de pago: hay que completar el pago para activarlo.');
    }

    const nombre = (dto.fullName || '').trim();
    if (nombre.length < 2) throw new BadRequestException('Falta el nombre');

    const r = await this.enrollMember({
      campaignId: campaign.id,
      planId: plan.id,
      fullName: nombre,
      phone: dto.phone ?? '',
      email: dto.email ?? null,
      source: 'FREE',
    });
    return { passId: r.passId, membershipId: r.membershipId, planName: plan.name };
  }

  async listMembers() {
    const campaign = await this.ensureLivingCampaign();
    const rows = await this.prisma.livingMembership.findMany({
      where: { campaignId: campaign.id },
      include: {
        customer: {
          select: { id: true, fullName: true, phone: true, email: true },
        },
        plan: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });
    return rows.map((m) => ({
      id: m.id,
      status: m.status,
      source: m.source,
      memberLevel: m.memberLevel,
      activatedAt: m.activatedAt,
      expiresAt: m.expiresAt,
      passId: m.passId,
      customer: m.customer,
      plan: m.plan,
    }));
  }

  // ---------------------------------------------------------------------------
  // Métricas base
  // ---------------------------------------------------------------------------

  async metrics() {
    const campaign = await this.ensureLivingCampaign();
    const [members, activeMembers, cardsIssued, walletInstalled, plans, categories] =
      await Promise.all([
        this.prisma.livingMembership.count({ where: { campaignId: campaign.id } }),
        this.prisma.livingMembership.count({
          where: { campaignId: campaign.id, status: 'ACTIVE' },
        }),
        this.prisma.pass.count({ where: { tenantId: campaign.tenantId } }),
        this.prisma.pass.count({
          where: { tenantId: campaign.tenantId, walletInstalledAt: { not: null } },
        }),
        this.prisma.membershipPlan.count({ where: { campaignId: campaign.id } }),
        this.prisma.benefitCategory.count({ where: { campaignId: campaign.id } }),
      ]);
    return { members, activeMembers, cardsIssued, walletInstalled, plans, categories };
  }

  // ---------------------------------------------------------------------------
  // Público (marketplace + "mi tarjeta")
  // ---------------------------------------------------------------------------

  async getPublicCampaign() {
    const campaign = await this.ensureLivingCampaign();
    const [plans, categories, stampPrograms] = await Promise.all([
      this.prisma.membershipPlan.findMany({
        where: { campaignId: campaign.id, isActive: true },
        orderBy: { sortOrder: 'asc' },
      }),
      this.prisma.benefitCategory.findMany({
        where: { campaignId: campaign.id, isActive: true },
        orderBy: { sortOrder: 'asc' },
      }),
      this.prisma.stampProgram.findMany({
        where: { campaignId: campaign.id, status: 'ACTIVE' },
        orderBy: { createdAt: 'desc' },
      }),
    ]);
    const cfg = (campaign.config as any) || {};
    return {
      name: campaign.name,
      slug: campaign.slug,
      status: campaign.status,
      welcomeText: campaign.welcomeText,
      marketplace: cfg.marketplace ?? {},
      stampPrograms: stampPrograms.map((p) => ({
        id: p.id,
        name: p.name,
        description: p.description,
        stampsRequired: p.stampsRequired,
        rewardText: p.rewardText,
      })),
      plans: plans.map((p) => ({
        id: p.id,
        name: p.name,
        priceCents: p.priceCents,
        currency: p.currency,
        interval: p.interval,
        description: p.description,
        benefitsAllowance: p.benefitsAllowance,
        level: p.level,
        // Solo los links de compra, que son públicos por definición. Los ids de
        // producto y de price NO salen acá: son configuración interna.
        checkoutUrl: p.hotmartCheckoutUrl || p.stripeCheckoutUrl || null,
        checkoutGateway: p.hotmartCheckoutUrl
          ? 'HOTMART'
          : p.stripeCheckoutUrl
            ? 'STRIPE'
            : 'MERCADOPAGO',
      })),
      categories: categories.map((c) => ({
        id: c.id,
        name: c.name,
        slug: c.slug,
        icon: c.icon,
      })),
    };
  }

  /**
   * "Mi tarjeta" por teléfono O email (spec §24).
   *
   * Hace falta el email porque quien compra por Hotmart o Stripe termina en la
   * página de gracias de la pasarela, no en la nuestra, y muchas veces ni
   * siquiera dejó teléfono: sin búsqueda por email pagó y no tiene forma de
   * llegar a su tarjeta.
   */
  async findCard(q: string) {
    const texto = (q || '').trim();
    if (texto.includes('@')) return this.findCardByEmail(texto);
    return this.findCardByPhone(texto);
  }

  private async findCardByEmail(emailRaw: string) {
    const campaign = await this.ensureLivingCampaign();
    const email = emailRaw.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { passes: [] };

    const customers = await this.prisma.customer.findMany({
      where: { tenantId: campaign.tenantId, email },
      select: { id: true },
    });
    if (!customers.length) return { passes: [] };

    const passes = await this.prisma.pass.findMany({
      where: {
        tenantId: campaign.tenantId,
        customerId: { in: customers.map((c) => c.id) },
        status: 'ACTIVE',
      },
      include: { customer: { select: { fullName: true } } },
      orderBy: { issuedAt: 'desc' },
    });
    return {
      passes: passes.map((p) => ({
        id: p.id,
        serialNumber: p.serialNumber,
        memberName: p.customer.fullName,
      })),
    };
  }

  /** "Mi tarjeta": busca los pases activos del miembro por teléfono (mismo
   *  patrón que passes.findByPhonePublic, pero por el tenant de sistema). */
  async findCardByPhone(phoneRaw: string) {
    const campaign = await this.ensureLivingCampaign();
    const digits = (phoneRaw || '').replace(/\D/g, '');
    if (digits.length < 7) return { passes: [] };
    const tail = digits.slice(-10);

    const customers = await this.prisma.customer.findMany({
      where: { tenantId: campaign.tenantId, phone: { contains: tail } },
      select: { id: true, fullName: true },
    });
    if (!customers.length) return { passes: [] };

    const passes = await this.prisma.pass.findMany({
      where: {
        tenantId: campaign.tenantId,
        customerId: { in: customers.map((c) => c.id) },
        status: 'ACTIVE',
      },
      include: { customer: { select: { fullName: true } } },
      orderBy: { issuedAt: 'desc' },
    });

    return {
      passes: passes.map((p) => ({
        id: p.id,
        serialNumber: p.serialNumber,
        memberName: p.customer.fullName,
      })),
    };
  }

  // ---------------------------------------------------------------------------
  // Negocios aliados (Fase 2)
  // ---------------------------------------------------------------------------

  private async uniqueAllySlug(base: string): Promise<string> {
    let slug = base || 'negocio';
    let i = 1;
    // AllyBusiness.slug es único global. Si choca, sufijo incremental.
    while (await this.prisma.allyBusiness.findUnique({ where: { slug } })) {
      slug = `${base}-${++i}`;
    }
    return slug;
  }

  private async assertCategory(campaignId: string, categoryId?: string | null) {
    if (!categoryId) return null;
    const cat = await this.prisma.benefitCategory.findFirst({
      where: { id: categoryId, campaignId },
    });
    if (!cat) throw new BadRequestException('Categoría inválida');
    return cat.id;
  }

  /** Crea un negocio aliado + su cuenta de login (role=ALLY_BUSINESS). */
  async createAlly(dto: {
    name: string;
    email: string;
    ownerFullName: string;
    password?: string;
    categoryId?: string | null;
    whatsapp?: string;
    city?: string;
    description?: string;
    /**
     * ALIADO TIPO A (spec §16): el Tenant de la marca blanca que ES este
     * negocio. Con valor, su escáner de siempre reconoce la tarjeta de la
     * cuponera. Sin valor = Tipo B (externo), usa el portal web.
     */
    tenantId?: string | null;
    // Ficha del negocio (spec §5). Todo opcional: el aliado puede completarla
    // desde su portal, pero cargarla acá evita la ida y vuelta.
    logoUrl?: string | null;
    coverUrl?: string | null;
    address?: string;
    instagram?: string;
    website?: string;
    /**
     * PRIMER BENEFICIO (spec §5, §6 y §7). Un aliado SIN beneficio no aparece
     * en la cartelera, así que darlo de alta sin esto deja el trabajo a medias
     * y a alguien volviendo después a terminarlo.
     */
    benefit?: {
      title: string;
      type?: string;
      percentOff?: number | null;
      amountOffCents?: number | null;
      terms?: string;
      validUntil?: string | null;
      maxPerMember?: number | null;
      limitPeriod?: string;
    } | null;
  }) {
    // Se verifica que el negocio EXISTA y que no sea un tenant de sistema:
    // vincular un aliado al tenant que HOSPEDA la cuponera sería circular.
    let tenantId: string | null = null;
    if (dto.tenantId) {
      const t = await this.prisma.tenant.findUnique({
        where: { id: dto.tenantId },
        select: { id: true, isCampaignHost: true },
      });
      if (!t) throw new BadRequestException('El negocio no existe');
      if (t.isCampaignHost) {
        throw new BadRequestException('Ese es un negocio de sistema, no puede ser aliado');
      }
      tenantId = t.id;
    }
    const campaign = await this.ensureLivingCampaign();
    const categoryId = await this.assertCategory(campaign.id, dto.categoryId);
    const email = dto.email.trim().toLowerCase();
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) throw new BadRequestException('Ya existe un usuario con ese email');

    const slug = await this.uniqueAllySlug(this.slugify(dto.name));
    const tempPassword = dto.password || nanoid(10);
    const passwordHash = await argon2.hash(tempPassword);

    const ally = await this.prisma.allyBusiness.create({
      data: {
        campaignId: campaign.id,
        name: dto.name,
        slug,
        categoryId,
        tenantId,
        whatsapp: dto.whatsapp || null,
        city: dto.city || '',
        description: dto.description || '',
        logoUrl: dto.logoUrl || null,
        coverUrl: dto.coverUrl || null,
        address: dto.address || '',
        instagram: dto.instagram || null,
        website: dto.website || null,
        status: 'PENDING',
        admins: {
          create: {
            email,
            passwordHash,
            fullName: dto.ownerFullName,
            role: 'ALLY_BUSINESS',
          },
        },
      },
      include: { admins: { select: { id: true, email: true, fullName: true } } },
    });

    // Beneficio inicial. Nace con la MISMA regla de aprobación que uno creado
    // desde el portal: si la campaña exige revisión queda PENDING, si no, activo.
    let benefit = null;
    if (dto.benefit?.title?.trim()) {
      const cfg = ((campaign.config as any) || {}) as Record<string, any>;
      benefit = await this.prisma.benefit.create({
        data: {
          campaignId: campaign.id,
          allyBusinessId: ally.id,
          categoryId,
          title: dto.benefit.title.trim(),
          type: (dto.benefit.type as any) || 'PERCENT_OFF',
          percentOff: dto.benefit.percentOff ?? null,
          amountOffCents: dto.benefit.amountOffCents ?? null,
          terms: dto.benefit.terms || '',
          validUntil: dto.benefit.validUntil ? new Date(dto.benefit.validUntil) : null,
          maxPerMember: dto.benefit.maxPerMember ?? null,
          limitPeriod: (dto.benefit.limitPeriod as any) || 'LIFETIME',
          status: 'ACTIVE',
          approval: cfg.requireBenefitApproval ? 'PENDING' : 'APPROVED',
        },
      });
    }

    return {
      ally,
      benefit,
      loginEmail: email,
      tempPassword: dto.password ? undefined : tempPassword,
    };
  }

  async listAllies() {
    const campaign = await this.ensureLivingCampaign();
    const rows = await this.prisma.allyBusiness.findMany({
      where: { campaignId: campaign.id },
      include: {
        category: { select: { id: true, name: true } },
        admins: { select: { email: true } },
        _count: { select: { admins: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });
    return rows;
  }

  private async assertAlly(campaignId: string, id: string) {
    const ally = await this.prisma.allyBusiness.findFirst({
      where: { id, campaignId },
    });
    if (!ally) throw new NotFoundException('Negocio aliado no encontrado');
    return ally;
  }

  async setAllyStatus(id: string, status: AllyStatus) {
    const campaign = await this.ensureLivingCampaign();
    await this.assertAlly(campaign.id, id);
    return this.prisma.allyBusiness.update({ where: { id }, data: { status } });
  }

  /** Edición de la ficha por el admin (desde Master Admin) o por el propio
   *  negocio (portal). `byOwner` limita el scope al ally de la sesión. */
  /** Días válidos de horario. Fuera de esto no se guarda nada. */
  private static readonly DIAS = ['lun', 'mar', 'mie', 'jue', 'vie', 'sab', 'dom'] as const;
  private static readonly MAX_FOTOS = 8;

  /**
   * Normaliza la galería del aliado.
   *
   * El aliado es un negocio EXTERNO con login propio, y esto se pinta en la
   * cartelera pública. Sin acotar, un PATCH podía guardar miles de entradas o
   * un `javascript:` que después sale en un href/src. Se aceptan solo http(s),
   * rutas propias y data:image, con tope de cantidad y de largo.
   */
  private normalizePhotos(input: unknown): string[] | undefined {
    if (input === undefined) return undefined;
    if (!Array.isArray(input)) return [];
    const ok = (u: string) =>
      /^https?:\/\//i.test(u) || u.startsWith('/') || /^data:image\//i.test(u);
    return input
      .filter((x): x is string => typeof x === 'string')
      .map((x) => x.trim())
      .filter((x) => x.length > 0 && x.length <= 2000 && ok(x))
      .slice(0, CuponeraService.MAX_FOTOS);
  }

  /**
   * Normaliza los horarios a { lun..dom: texto }. Se deja texto libre a
   * propósito ("8-18", "8-12 y 14-19", "Cerrado"): imponer un formato rígido
   * obliga al negocio a mentir cuando su realidad no encaja. Lo que sí se acota
   * son las claves y el largo, porque el JSON es libre y se muestra en público.
   */
  private normalizeHours(input: unknown): Record<string, string> | undefined {
    if (input === undefined) return undefined;
    if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
    const src = input as Record<string, unknown>;
    const out: Record<string, string> = {};
    for (const d of CuponeraService.DIAS) {
      const v = src[d];
      if (typeof v !== 'string') continue;
      const t = v.trim().slice(0, 40);
      if (t) out[d] = t;
    }
    return out;
  }

  private allyUpdatableData(dto: AllyProfileDto) {
    return {
      name: dto.name ?? undefined,
      description: dto.description ?? undefined,
      logoUrl: dto.logoUrl ?? undefined,
      coverUrl: dto.coverUrl ?? undefined,
      photos: this.normalizePhotos(dto.photos) as any,
      address: dto.address ?? undefined,
      city: dto.city ?? undefined,
      latitude: dto.latitude ?? undefined,
      longitude: dto.longitude ?? undefined,
      hours: this.normalizeHours(dto.hours) as any,
      whatsapp: dto.whatsapp ?? undefined,
      instagram: dto.instagram ?? undefined,
      website: dto.website ?? undefined,
    };
  }

  async updateAllyByAdmin(id: string, dto: AllyProfileDto & { categoryId?: string | null }) {
    const campaign = await this.ensureLivingCampaign();
    await this.assertAlly(campaign.id, id);
    const categoryId =
      dto.categoryId === undefined
        ? undefined
        : await this.assertCategory(campaign.id, dto.categoryId);
    return this.prisma.allyBusiness.update({
      where: { id },
      data: { ...this.allyUpdatableData(dto), ...(categoryId !== undefined ? { categoryId } : {}) },
    });
  }

  // --- Portal del negocio aliado ---

  async getAllyForPortal(user: AuthUser) {
    if (!user.allyBusinessId) throw new ForbiddenException('Sesión sin negocio aliado');
    const ally = await this.prisma.allyBusiness.findUnique({
      where: { id: user.allyBusinessId },
      include: { category: { select: { id: true, name: true } } },
    });
    if (!ally) throw new NotFoundException('Negocio no encontrado');
    return ally;
  }

  async updateAllyProfile(user: AuthUser, dto: AllyProfileDto) {
    if (!user.allyBusinessId) throw new ForbiddenException('Sesión sin negocio aliado');
    return this.prisma.allyBusiness.update({
      where: { id: user.allyBusinessId },
      data: this.allyUpdatableData(dto),
    });
  }

  // --- Push del aliado (spec §22) ---

  /** Cuántos envíos le quedan al aliado en su ventana. */
  async allyPushQuota(user: AuthUser) {
    const ally = await this.getAllyForPortal(user);
    const campaign = await this.ensureLivingCampaign();
    const cfg = ((campaign.config as any) || {}) as Record<string, any>;
    // Default 1 por semana. La cuponera lo sube o lo baja desde su config; 0 lo
    // apaga por completo.
    const limite = Number.isFinite(Number(cfg.allyPushPerWeek)) ? Number(cfg.allyPushPerWeek) : 1;
    const desde = benefitPeriodStart('WEEK', new Date())!;
    const usados = await this.prisma.allyPush.count({
      where: { allyBusinessId: ally.id, createdAt: { gte: desde } },
    });
    return {
      limite,
      usados,
      restantes: Math.max(0, limite - usados),
      // La semana arranca el LUNES, mismo criterio que los topes de beneficio.
      renuevaEl: new Date(desde.getTime() + 7 * 24 * 60 * 60 * 1000),
    };
  }

  /**
   * El aliado avisa a quienes ya usaron su beneficio (§22). No puede escribirle
   * a toda la comunidad: eso es del admin de la cuponera. El segmento sale de
   * SU allyBusinessId, nunca de un id que venga en el body.
   */
  async sendAllyPush(user: AuthUser, dto: { title: string; body: string }) {
    const ally = await this.getAllyForPortal(user);
    if (ally.status !== 'APPROVED') {
      throw new BadRequestException('Tu negocio todavía no está aprobado en la cuponera');
    }
    const title = (dto.title ?? '').trim();
    const body = (dto.body ?? '').trim();
    if (!title || !body) throw new BadRequestException('Falta el título o el mensaje');

    const cuota = await this.allyPushQuota(user);
    if (cuota.limite === 0) {
      throw new BadRequestException('La cuponera tiene desactivados los avisos de los aliados');
    }
    if (cuota.restantes <= 0) {
      throw new BadRequestException(
        `Ya usaste tus ${cuota.limite} ${cuota.limite === 1 ? 'aviso' : 'avisos'} de esta semana. ` +
        `Vuelven a estar disponibles el ${cuota.renuevaEl.toLocaleDateString('es-CO')}.`,
      );
    }

    const r = await this.sendSegmentPush({ allyId: ally.id, title, body });

    // Se registra DESPUÉS del envío y solo si salió: si el push falla, no le
    // gastamos el cupo de la semana al aliado.
    await this.prisma.allyPush.create({
      data: {
        campaignId: (await this.ensureLivingCampaign()).id,
        allyBusinessId: ally.id,
        userId: user.id,
        title, body,
        targeted: (r as any)?.targeted ?? 0,
        sent: (r as any)?.sent ?? 0,
      },
    }).catch(() => null);

    return { ...r, quota: await this.allyPushQuota(user) };
  }

  /** Historial de avisos del aliado (§20 "Push enviados"). */
  async listAllyPushes(user: AuthUser) {
    const ally = await this.getAllyForPortal(user);
    return this.prisma.allyPush.findMany({
      where: { allyBusinessId: ally.id },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  // --- Historial de cambios del beneficio (spec §6) ---

  /**
   * Deja constancia de una edición. NUNCA lanza: perder el historial es malo,
   * pero tumbar la edición del aliado por un fallo al registrar es peor.
   * Si el diff sale vacío (no cambió nada de lo que se rastrea) no escribe.
   */
  private async recordBenefitChange(
    benefitId: string,
    user: AuthUser | null,
    action: 'CREATE' | 'UPDATE' | 'APPROVAL' | 'DELETE',
    before: Record<string, unknown>,
    after: Record<string, unknown>,
  ) {
    try {
      const changes = diffBenefit(before, after);
      if (action === 'UPDATE' && Object.keys(changes).length === 0) return;
      const actor = actorOf(
        user ? { id: user.id, fullName: (user as any).fullName ?? null, role: user.role } : null,
      );
      await this.prisma.benefitChange.create({
        data: { benefitId, action, changes: changes as any, ...actor },
      });
    } catch {
      /* el historial no puede romper la operación */
    }
  }

  /** Historial de un beneficio, del más nuevo al más viejo (§6). */
  async listBenefitHistory(user: AuthUser, benefitId: string) {
    // El aliado solo ve el historial de SUS beneficios; el admin de Fidelity, el
    // de cualquiera.
    if (user.role === 'ALLY_BUSINESS') {
      const ally = await this.getAllyForPortal(user);
      await this.assertAllyBenefit(ally.id, benefitId);
    }
    return this.prisma.benefitChange.findMany({
      where: { benefitId },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }

  // --- Sedes del aliado (spec §5 y §9) ---
  //
  // TODO scopea por `user.allyBusinessId`. En update/delete NO alcanza con
  // buscar por id: hay que exigir TAMBIÉN el allyBusinessId, o un aliado podría
  // editar la sede de otro adivinando el id. Por eso van con updateMany/
  // deleteMany (las dos condiciones juntas) y se revisa el `count`.

  async listAllyLocations(user: AuthUser) {
    const ally = await this.getAllyForPortal(user);
    return this.prisma.allyLocation.findMany({
      where: { allyBusinessId: ally.id },
      orderBy: [{ isActive: 'desc' }, { createdAt: 'asc' }],
    });
  }

  async createAllyLocation(user: AuthUser, dto: AllyLocationDto) {
    const ally = await this.getAllyForPortal(user);
    const name = (dto.name ?? '').trim();
    if (!name) throw new BadRequestException('La sede necesita un nombre');
    return this.prisma.allyLocation.create({
      data: { allyBusinessId: ally.id, ...this.locationData(dto), name },
    });
  }

  async updateAllyLocation(user: AuthUser, id: string, dto: AllyLocationDto) {
    const ally = await this.getAllyForPortal(user);
    const res = await this.prisma.allyLocation.updateMany({
      where: { id, allyBusinessId: ally.id },
      data: this.locationData(dto),
    });
    if (res.count === 0) throw new NotFoundException('Sede no encontrada');
    return this.prisma.allyLocation.findUnique({ where: { id } });
  }

  async deleteAllyLocation(user: AuthUser, id: string) {
    const ally = await this.getAllyForPortal(user);
    const res = await this.prisma.allyLocation.deleteMany({
      where: { id, allyBusinessId: ally.id },
    });
    if (res.count === 0) throw new NotFoundException('Sede no encontrada');
    return { ok: true };
  }

  /** Campos editables de una sede. Solo escribe lo que vino en el body. */
  private locationData(dto: AllyLocationDto) {
    const d: Record<string, unknown> = {};
    if (dto.name !== undefined) d.name = dto.name.trim();
    if (dto.address !== undefined) d.address = dto.address.trim();
    if (dto.city !== undefined) d.city = dto.city.trim();
    if (dto.latitude !== undefined) d.latitude = dto.latitude;
    if (dto.longitude !== undefined) d.longitude = dto.longitude;
    if (dto.radiusMeters !== undefined) d.radiusMeters = dto.radiusMeters;
    if (dto.geopushMessage !== undefined) d.geopushMessage = dto.geopushMessage.trim();
    if (dto.isActive !== undefined) d.isActive = dto.isActive;
    if (dto.geopushActive !== undefined) {
      // Un geofence sin coordenadas no dispara nunca: mejor rechazarlo que dejar
      // al aliado con el interruptor en "activo" creyendo que funciona.
      if (dto.geopushActive && (dto.latitude === null || dto.longitude === null)) {
        throw new BadRequestException(
          'Para activar el geopush la sede necesita latitud y longitud',
        );
      }
      d.geopushActive = dto.geopushActive;
    }
    return d;
  }

  // --- Público (marketplace de negocios) ---

  async listPublicAllies(categorySlug?: string) {
    const campaign = await this.ensureLivingCampaign();
    const allies = await this.prisma.allyBusiness.findMany({
      where: {
        campaignId: campaign.id,
        status: 'APPROVED',
        ...(categorySlug ? { category: { slug: categorySlug } } : {}),
      },
      include: { category: { select: { name: true, slug: true, icon: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return allies.map((a) => ({
      slug: a.slug,
      name: a.name,
      description: a.description,
      logoUrl: a.logoUrl,
      coverUrl: a.coverUrl,
      city: a.city,
      category: a.category,
    }));
  }

  async getPublicAlly(slug: string) {
    const campaign = await this.ensureLivingCampaign();
    const a = await this.prisma.allyBusiness.findFirst({
      where: { slug, campaignId: campaign.id, status: 'APPROVED' },
      include: { category: { select: { name: true, slug: true, icon: true } } },
    });
    if (!a) throw new NotFoundException('Negocio no encontrado');
    return {
      slug: a.slug,
      name: a.name,
      description: a.description,
      logoUrl: a.logoUrl,
      coverUrl: a.coverUrl,
      photos: a.photos,
      address: a.address,
      city: a.city,
      latitude: a.latitude != null ? Number(a.latitude) : null,
      longitude: a.longitude != null ? Number(a.longitude) : null,
      hours: a.hours,
      whatsapp: a.whatsapp,
      instagram: a.instagram,
      website: a.website,
      category: a.category,
    };
  }

  // ---------------------------------------------------------------------------
  // Beneficios / promociones (Fase 3)
  // ---------------------------------------------------------------------------

  private benefitData(dto: BenefitDto) {
    const opt = <T>(v: T | undefined) => (v === undefined ? undefined : v);
    return {
      type: opt(dto.type) as any,
      description: opt(dto.description),
      imageUrl: opt(dto.imageUrl),
      terms: opt(dto.terms),
      percentOff: opt(dto.percentOff),
      amountOffCents: opt(dto.amountOffCents),
      normalPriceCents: opt(dto.normalPriceCents),
      memberPriceCents: opt(dto.memberPriceCents),
      currency: opt(dto.currency),
      validFrom:
        dto.validFrom === undefined ? undefined : dto.validFrom ? new Date(dto.validFrom) : null,
      validUntil:
        dto.validUntil === undefined ? undefined : dto.validUntil ? new Date(dto.validUntil) : null,
      maxRedemptions: opt(dto.maxRedemptions),
      maxPerMember: opt(dto.maxPerMember),
    };
  }

  private benefitInWindow(b: { validFrom: Date | null; validUntil: Date | null }): boolean {
    const now = Date.now();
    if (b.validFrom && b.validFrom.getTime() > now) return false;
    if (b.validUntil && b.validUntil.getTime() < now) return false;
    return true;
  }

  private publicBenefitWhere(campaignId: string) {
    const now = new Date();
    return {
      campaignId,
      status: 'ACTIVE' as const,
      approval: 'APPROVED' as const,
      ally: { status: 'APPROVED' as const },
      AND: [
        { OR: [{ validFrom: null }, { validFrom: { lte: now } }] },
        { OR: [{ validUntil: null }, { validUntil: { gte: now } }] },
      ],
    };
  }

  // --- Beneficios del aliado (portal) ---

  async listAllyBenefits(user: AuthUser) {
    const ally = await this.getAllyForPortal(user);
    return this.prisma.benefit.findMany({
      where: { allyBusinessId: ally.id },
      orderBy: { createdAt: 'desc' },
    });
  }

  async createAllyBenefit(user: AuthUser, dto: BenefitDto) {
    const ally = await this.getAllyForPortal(user);
    const campaign = await this.ensureLivingCampaign();
    const categoryId = await this.assertCategory(campaign.id, dto.categoryId);
    const needsApproval = !!(campaign.config as any)?.requireBenefitApproval;
    if (!dto.title?.trim()) throw new BadRequestException('Título requerido');
    return this.prisma.benefit.create({
      data: {
        campaignId: campaign.id,
        allyBusinessId: ally.id,
        categoryId,
        title: dto.title!.trim(),
        status: (dto.status as any) ?? 'ACTIVE',
        approval: needsApproval ? 'PENDING' : 'APPROVED',
        ...this.benefitData(dto),
        type: (dto.type as any) ?? 'PERCENT_OFF',
      },
    });
  }

  private async assertAllyBenefit(allyId: string, id: string) {
    const b = await this.prisma.benefit.findFirst({ where: { id, allyBusinessId: allyId } });
    if (!b) throw new NotFoundException('Beneficio no encontrado');
    return b;
  }

  async updateAllyBenefit(user: AuthUser, id: string, dto: BenefitDto) {
    const ally = await this.getAllyForPortal(user);
    await this.assertAllyBenefit(ally.id, id);
    const campaign = await this.ensureLivingCampaign();
    const categoryId =
      dto.categoryId === undefined ? undefined : await this.assertCategory(campaign.id, dto.categoryId);
    // El "antes" se lee ANTES de escribir: después ya no hay con qué comparar.
    const before = await this.prisma.benefit.findUnique({ where: { id } });
    const data = {
      ...this.benefitData(dto),
      ...(dto.title !== undefined ? { title: dto.title } : {}),
      ...(categoryId !== undefined ? { categoryId } : {}),
      ...(dto.status ? { status: dto.status as any } : {}),
    };
    const updated = await this.prisma.benefit.update({ where: { id }, data });
    await this.recordBenefitChange(id, user, 'UPDATE', before ?? {}, data);
    return updated;
  }

  async deleteAllyBenefit(user: AuthUser, id: string) {
    const ally = await this.getAllyForPortal(user);
    await this.assertAllyBenefit(ally.id, id);
    await this.prisma.benefit.delete({ where: { id } });
    return { ok: true };
  }

  // --- Beneficios (admin de campaña) ---

  async listAllBenefits() {
    const campaign = await this.ensureLivingCampaign();
    return this.prisma.benefit.findMany({
      where: { campaignId: campaign.id },
      include: {
        ally: { select: { id: true, name: true } },
        category: { select: { name: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });
  }

  async setBenefitApproval(
    id: string,
    approval: 'PENDING' | 'APPROVED' | 'REJECTED',
    user?: AuthUser,
  ) {
    const campaign = await this.ensureLivingCampaign();
    const b = await this.prisma.benefit.findFirst({ where: { id, campaignId: campaign.id } });
    if (!b) throw new NotFoundException('Beneficio no encontrado');
    const updated = await this.prisma.benefit.update({ where: { id }, data: { approval } });
    // Aprobar o rechazar también es un cambio del beneficio: si no queda en el
    // historial, no se puede reconstruir por qué dejó de estar visible.
    await this.recordBenefitChange(id, user ?? null, 'APPROVAL', b, { approval });
    return updated;
  }

  async setRequireBenefitApproval(value: boolean) {
    const campaign = await this.ensureLivingCampaign();
    const cfg = ((campaign.config as any) || {}) as Record<string, any>;
    cfg.requireBenefitApproval = value;
    await this.prisma.benefitCampaign.update({
      where: { id: campaign.id },
      data: { config: cfg as any },
    });
    return { ok: true, requireBenefitApproval: value };
  }

  // --- Público (marketplace de beneficios) ---

  private publicBenefitShape(b: any, full = false) {
    return {
      id: b.id,
      type: b.type,
      title: b.title,
      description: b.description,
      imageUrl: b.imageUrl,
      percentOff: b.percentOff,
      amountOffCents: b.amountOffCents,
      normalPriceCents: b.normalPriceCents,
      memberPriceCents: b.memberPriceCents,
      currency: b.currency,
      validUntil: b.validUntil,
      // El tope y su ventana van SIEMPRE, no solo en `full`: la tarjeta de la
      // cartelera ya muestra "2 por mes" y pedir un segundo fetch para eso
      // obligaría a golpear la API por cada tarjeta de la grilla.
      maxPerMember: b.maxPerMember,
      limitPeriod: b.limitPeriod,
      ally: b.ally,
      category: b.category,
      ...(full ? { terms: b.terms, validFrom: b.validFrom } : {}),
    };
  }

  async listPublicBenefits(categorySlug?: string) {
    const campaign = await this.ensureLivingCampaign();
    const benefits = await this.prisma.benefit.findMany({
      where: {
        ...this.publicBenefitWhere(campaign.id),
        ...(categorySlug ? { category: { slug: categorySlug } } : {}),
      },
      include: {
        ally: {
          select: {
            name: true, slug: true, city: true, logoUrl: true,
            locations: {
              where: { isActive: true },
              select: { id: true, name: true, address: true, city: true },
              orderBy: { createdAt: 'asc' },
            },
          },
        },
        category: { select: { name: true, slug: true, icon: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    return benefits.map((b) => this.publicBenefitShape(b));
  }

  async getPublicBenefit(id: string) {
    const campaign = await this.ensureLivingCampaign();
    const b = await this.prisma.benefit.findFirst({
      where: { id, ...this.publicBenefitWhere(campaign.id) },
      include: {
        ally: {
          select: {
            name: true, slug: true, city: true, address: true, logoUrl: true, whatsapp: true,
            locations: {
              where: { isActive: true },
              select: { id: true, name: true, address: true, city: true },
              orderBy: { createdAt: 'asc' },
            },
          },
        },
        category: { select: { name: true, slug: true, icon: true } },
      },
    });
    if (!b) throw new NotFoundException('Beneficio no disponible');
    return this.publicBenefitShape(b, true);
  }

  // ---------------------------------------------------------------------------
  // Canje por QR (Fase 3)
  // ---------------------------------------------------------------------------

  private async resolvePass(tenantId: string, qrToken: string) {
    const token = (qrToken || '').trim();
    if (!token) return null;
    return this.prisma.pass.findFirst({
      where: {
        tenantId,
        OR: [{ qrToken: token }, { legacyQrTokens: { has: token } }, { serialNumber: token }],
      },
    });
  }

  /** El aliado escanea el QR del miembro → devuelve al miembro + los beneficios
   *  del negocio con su disponibilidad (para elegir cuál canjear). */
  /**
   * Escaneo desde el PORTAL del aliado (Tipo B, y Tipo A que igual quiera usarlo).
   * La sesión trae `allyBusinessId`, así que el aliado sale de ahí.
   */
  async scanMember(user: AuthUser, qrToken: string) {
    const ally = await this.getAllyForPortal(user);
    const campaign = await this.ensureLivingCampaign();
    const pass = await this.resolvePass(campaign.tenantId, qrToken);
    if (!pass) throw new NotFoundException('Tarjeta no encontrada');
    return this.buildMemberScan(campaign, ally, pass);
  }

  /**
   * Escaneo de una tarjeta de cuponera desde el escáner PROPIO de un aliado
   * TIPO A (spec §16): un negocio que ya es cliente de la marca blanca y no
   * debería tener que usar un segundo escáner.
   *
   * Devuelve null —NO lanza— cuando no aplica, para que el llamador siga con su
   * flujo normal y termine en la guarda de aislamiento de siempre. Fail-closed:
   * cualquier duda es null.
   *
   * La campaña se resuelve por el TENANT DEL PASE, no por el slug fijo de
   * ensureLivingCampaign(): así funciona con varias cuponeras sin tocar nada.
   */
  async scanMemberAsTenantAlly(
    user: AuthUser,
    pass: { id: string; tenantId: string; customerId: string },
  ) {
    if (!user.tenantId) return null;
    // El pase tiene que ser de un tenant que HOSPEDA una cuponera.
    const campaign = await this.prisma.benefitCampaign.findUnique({
      where: { tenantId: pass.tenantId },
    });
    if (!campaign || campaign.status !== 'ACTIVE') return null;
    // Y el negocio que escanea tiene que ser aliado APROBADO de ESA campaña.
    const ally = await this.prisma.allyBusiness.findFirst({
      where: {
        campaignId: campaign.id,
        tenantId: user.tenantId,
        status: 'APPROVED',
      },
      include: { category: { select: { id: true, name: true } } },
    });
    if (!ally) return null;
    return this.buildMemberScan(campaign, ally, pass);
  }

  /** Payload del escaneo. Compartido por las dos puertas de entrada. */
  /**
   * Margen tras el vencimiento antes de bloquear los beneficios.
   *
   * El cobro recurrente no cae exactamente el día del vencimiento: las pasarelas
   * reintentan una tarjeta rechazada durante días (Stripe hasta ~3 semanas,
   * Hotmart varios intentos). Sin margen, un miembro que SÍ va a renovar queda
   * plantado en la caja del aliado por unas horas de desfase. Tres días cubre el
   * desfase normal sin volver eterno el acceso de quien realmente se dio de baja
   * — la baja explícita no pasa por acá: llega por webhook y cambia el status.
   */
  private static readonly GRACE_DAYS = 3;

  /** true si la membresía tiene vencimiento y ya pasó (contando el margen). */
  private membershipExpired(m: { expiresAt: Date | null } | null): boolean {
    if (!m?.expiresAt) return false;
    const limite =
      m.expiresAt.getTime() + CuponeraService.GRACE_DAYS * 24 * 60 * 60 * 1000;
    return limite <= Date.now();
  }

  /** Lectura sin efectos: ¿esta membresía habilita beneficios ahora mismo? */
  private membershipUsable(
    m: { status: string; expiresAt: Date | null } | null,
  ): boolean {
    return !!m && m.status === 'ACTIVE' && !this.membershipExpired(m);
  }

  /**
   * Puerta única de todos los canjes (spec §24: "membresía inactiva →
   * beneficios bloqueados"). Antes cada canje comparaba `status !== 'ACTIVE'` a
   * mano y NADIE miraba `expiresAt`: si el cobro recurrente simplemente dejaba
   * de llegar, no hay webhook que avise, así que la fila se quedaba ACTIVE para
   * siempre y la tarjeta seguía canjeando gratis.
   *
   * Además corrige la fila al detectar el vencimiento, para que el panel y las
   * métricas no sigan contando como activo a quien no lo está.
   */
  private async assertMembershipUsable(campaignId: string, customerId: string) {
    const membership = await this.prisma.livingMembership.findFirst({
      where: { campaignId, customerId },
    });
    if (!membership) {
      throw new BadRequestException('Esta tarjeta no tiene membresía en esta cuponera');
    }
    if (membership.status === 'ACTIVE' && this.membershipExpired(membership)) {
      await this.prisma.livingMembership
        .update({ where: { id: membership.id }, data: { status: 'EXPIRED' } })
        .catch(() => null);
      throw new BadRequestException(
        'La membresía venció. Hay que renovarla para volver a usar los beneficios.',
      );
    }
    if (membership.status !== 'ACTIVE') {
      throw new BadRequestException('La membresía no está activa');
    }
    return membership;
  }

  private async buildMemberScan(
    campaign: BenefitCampaign,
    ally: { id: string; categoryId: string | null },
    pass: { id: string; customerId: string },
  ) {

    const [customer, membership, benefits] = await Promise.all([
      this.prisma.customer.findUnique({
        where: { id: pass.customerId },
        select: { fullName: true },
      }),
      this.prisma.livingMembership.findFirst({
        where: { campaignId: campaign.id, customerId: pass.customerId },
        include: { plan: { select: { name: true } } },
      }),
      this.prisma.benefit.findMany({
        where: { allyBusinessId: ally.id, status: 'ACTIVE', approval: 'APPROVED' },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    const active = this.membershipUsable(membership);
    // Usos del miembro por beneficio, CADA UNO dentro de SU ventana (spec §7).
    // Antes esto contaba el histórico completo, lo que mostraba "0 usos
    // restantes" a alguien que sí podía canjear este mes — y no coincidía con
    // lo que después decidía redeemBenefit. Una sola query: se traen los canjes
    // desde la ventana MÁS ANTIGUA y se filtra por beneficio en memoria (si
    // alguno es LIFETIME no se acota por fecha).
    const now = new Date();
    const starts = benefits.map((b) =>
      benefitPeriodStart(b.limitPeriod as BenefitLimitPeriod, now),
    );
    const anyLifetime = starts.some((d) => d === null);
    const oldest = anyLifetime
      ? null
      : new Date(Math.min(...starts.map((d) => (d as Date).getTime())));
    const rows = benefits.length
      ? await this.prisma.redemption.findMany({
          where: {
            customerId: pass.customerId,
            benefitId: { in: benefits.map((b) => b.id) },
            ...(oldest ? { createdAt: { gte: oldest } } : {}),
          },
          select: { benefitId: true, createdAt: true },
        })
      : [];
    const used = new Map<string, number>();
    benefits.forEach((b, idx) => {
      const since = starts[idx];
      const n = rows.filter(
        (r) => r.benefitId === b.id && (!since || r.createdAt >= since),
      ).length;
      used.set(b.id, n);
    });

    // Sellos comunitarios aplicables a este aliado + progreso del miembro.
    const programs = await this.prisma.stampProgram.findMany({
      where: this.allyStampWhere(campaign.id, ally.categoryId),
      orderBy: { createdAt: 'desc' },
    });
    const progIds = programs.map((p) => p.id);
    const stampCards = progIds.length
      ? await this.prisma.stampCard.findMany({
          where: { customerId: pass.customerId, programId: { in: progIds } },
        })
      : [];
    const cardByProg = new Map(stampCards.map((c) => [c.programId, c]));
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const dayEvents = progIds.length
      ? await this.prisma.stampEvent.groupBy({
          by: ['programId'],
          where: { customerId: pass.customerId, programId: { in: progIds }, action: 'STAMP', createdAt: { gte: since } },
          _count: true,
        })
      : [];
    const dayByProg = new Map(dayEvents.map((e) => [e.programId, e._count]));

    return {
      passId: pass.id,
      memberName: customer?.fullName ?? '',
      membershipActive: active,
      // El estado que se muestra es el REAL: una fila ACTIVE cuya fecha ya pasó
      // se lee como EXPIRED, para que el aliado no vea "activa" y un rechazo.
      membershipStatus: membership
        ? membership.status === 'ACTIVE' && this.membershipExpired(membership)
          ? 'EXPIRED'
          : membership.status
        : 'NONE',
      membershipExpiresAt: membership?.expiresAt ?? null,
      planName: membership?.plan?.name ?? null,
      stampPrograms: programs.map((p) => {
        const card = cardByProg.get(p.id);
        const count = card?.stampsCount ?? 0;
        const today = dayByProg.get(p.id) ?? 0;
        return {
          id: p.id,
          name: p.name,
          stampsCount: count,
          stampsRequired: p.stampsRequired,
          rewardText: p.rewardText,
          rewardReady: count >= p.stampsRequired,
          canStamp: active && today < p.maxPerDay,
        };
      }),
      benefits: benefits.map((b) => {
        const mine = used.get(b.id) ?? 0;
        const perMemberLeft = b.maxPerMember == null ? null : Math.max(0, b.maxPerMember - mine);
        const totalLeft =
          b.maxRedemptions == null ? null : Math.max(0, b.maxRedemptions - b.redemptionCount);
        const canRedeem =
          active &&
          this.benefitInWindow(b) &&
          (perMemberLeft == null || perMemberLeft > 0) &&
          (totalLeft == null || totalLeft > 0);
        return {
          id: b.id,
          title: b.title,
          type: b.type,
          perMemberLeft,
          totalLeft,
          canRedeem,
        };
      }),
    };
  }

  /** Registra el canje (valida membresía + vigencia + límites + anti-doble con
   *  advisory lock para serializar canjes concurrentes del mismo beneficio). */
  async redeemBenefit(
    user: AuthUser,
    dto: { passId?: string; qrToken?: string; benefitId: string },
  ) {
    const ally = await this.getAllyForPortal(user);
    const campaign = await this.ensureLivingCampaign();

    const pass = dto.passId
      ? await this.prisma.pass.findFirst({
          where: { id: dto.passId, tenantId: campaign.tenantId },
        })
      : await this.resolvePass(campaign.tenantId, dto.qrToken || '');
    if (!pass) throw new NotFoundException('Tarjeta no encontrada');

    await this.assertMembershipUsable(campaign.id, pass.customerId);

    const benefit = await this.prisma.benefit.findFirst({
      where: { id: dto.benefitId, allyBusinessId: ally.id, campaignId: campaign.id },
    });
    if (!benefit) throw new NotFoundException('Beneficio no encontrado');
    if (benefit.status !== 'ACTIVE' || benefit.approval !== 'APPROVED') {
      throw new BadRequestException('Beneficio no disponible');
    }
    if (!this.benefitInWindow(benefit)) {
      throw new BadRequestException('Beneficio fuera de vigencia');
    }

    const redemption = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        `SELECT pg_advisory_xact_lock(hashtext($1))`,
        `cuponera-redeem:${benefit.id}`,
      );
      if (benefit.maxRedemptions != null) {
        const total = await tx.redemption.count({ where: { benefitId: benefit.id } });
        if (total >= benefit.maxRedemptions) {
          throw new BadRequestException('Se agotaron los canjes de este beneficio');
        }
      }
      if (benefit.maxPerMember != null) {
        // Tope por miembro dentro de su VENTANA (spec §7). LIFETIME → since=null
        // → cuenta todo el historial, que es el comportamiento previo y el
        // default de la columna. El conteo va DENTRO del advisory lock: si se
        // hiciera antes, dos canjes simultáneos leerían el mismo total y
        // pasarían los dos.
        const since = benefitPeriodStart(
          benefit.limitPeriod as BenefitLimitPeriod,
          new Date(),
        );
        const mine = await tx.redemption.count({
          where: {
            benefitId: benefit.id,
            customerId: pass.customerId,
            ...(since ? { createdAt: { gte: since } } : {}),
          },
        });
        if (mine >= benefit.maxPerMember) {
          throw new BadRequestException(
            since
              ? `Este miembro ya agotó sus canjes de este beneficio (${describeLimit(benefit.maxPerMember, benefit.limitPeriod as BenefitLimitPeriod)})`
              : 'Este miembro ya usó este beneficio',
          );
        }
      }
      const red = await tx.redemption.create({
        data: {
          campaignId: campaign.id,
          benefitId: benefit.id,
          allyBusinessId: ally.id,
          customerId: pass.customerId,
          passId: pass.id,
          operatorUserId: user.id,
        },
      });
      await tx.benefit.update({
        where: { id: benefit.id },
        data: { redemptionCount: { increment: 1 } },
      });
      return red;
    });

    const customer = await this.prisma.customer.findUnique({
      where: { id: pass.customerId },
      select: { fullName: true },
    });
    return {
      ok: true,
      redemptionId: redemption.id,
      benefitTitle: benefit.title,
      memberName: customer?.fullName ?? '',
    };
  }

  async allyRedemptions(user: AuthUser) {
    const ally = await this.getAllyForPortal(user);
    const rows = await this.prisma.redemption.findMany({
      where: { allyBusinessId: ally.id },
      include: {
        benefit: { select: { title: true } },
        customer: { select: { fullName: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    return rows.map((r) => ({
      id: r.id,
      at: r.createdAt,
      benefit: r.benefit.title,
      member: r.customer.fullName,
    }));
  }

  async allyMetrics(user: AuthUser) {
    const ally = await this.getAllyForPortal(user);
    const [benefits, activeBenefits, redemptions, uniq] = await Promise.all([
      this.prisma.benefit.count({ where: { allyBusinessId: ally.id } }),
      this.prisma.benefit.count({
        where: { allyBusinessId: ally.id, status: 'ACTIVE', approval: 'APPROVED' },
      }),
      this.prisma.redemption.count({ where: { allyBusinessId: ally.id } }),
      this.prisma.redemption.findMany({
        where: { allyBusinessId: ally.id },
        distinct: ['customerId'],
        select: { customerId: true },
      }),
    ]);
    return { benefits, activeBenefits, redemptions, uniqueMembers: uniq.length };
  }

  // ---------------------------------------------------------------------------
  // Sellos comunitarios (Fase 5)
  // ---------------------------------------------------------------------------

  async listStampPrograms() {
    const campaign = await this.ensureLivingCampaign();
    return this.prisma.stampProgram.findMany({
      where: { campaignId: campaign.id },
      include: { category: { select: { name: true } }, _count: { select: { cards: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async createStampProgram(dto: StampProgramDto) {
    const campaign = await this.ensureLivingCampaign();
    const categoryId = await this.assertCategory(campaign.id, dto.categoryId);
    if (!dto.name?.trim()) throw new BadRequestException('Nombre requerido');
    return this.prisma.stampProgram.create({
      data: {
        campaignId: campaign.id,
        categoryId,
        name: dto.name.trim(),
        description: dto.description ?? '',
        imageUrl: dto.imageUrl,
        stampsRequired: dto.stampsRequired ?? 5,
        rewardText: dto.rewardText ?? '',
        maxPerDay: dto.maxPerDay ?? 1,
        status: (dto.status as any) ?? 'ACTIVE',
      },
    });
  }

  private async assertStampProgram(campaignId: string, id: string) {
    const p = await this.prisma.stampProgram.findFirst({ where: { id, campaignId } });
    if (!p) throw new NotFoundException('Programa de sellos no encontrado');
    return p;
  }

  async updateStampProgram(id: string, dto: StampProgramDto) {
    const campaign = await this.ensureLivingCampaign();
    await this.assertStampProgram(campaign.id, id);
    const categoryId =
      dto.categoryId === undefined ? undefined : await this.assertCategory(campaign.id, dto.categoryId);
    return this.prisma.stampProgram.update({
      where: { id },
      data: {
        name: dto.name ?? undefined,
        description: dto.description ?? undefined,
        imageUrl: dto.imageUrl ?? undefined,
        stampsRequired: dto.stampsRequired ?? undefined,
        rewardText: dto.rewardText ?? undefined,
        maxPerDay: dto.maxPerDay ?? undefined,
        status: (dto.status as any) ?? undefined,
        ...(categoryId !== undefined ? { categoryId } : {}),
      },
    });
  }

  async deleteStampProgram(id: string) {
    const campaign = await this.ensureLivingCampaign();
    await this.assertStampProgram(campaign.id, id);
    await this.prisma.stampProgram.delete({ where: { id } });
    return { ok: true };
  }

  /** Programas de sellos aplicables a un aliado: activos y de categoría libre
   *  o coincidente con la del negocio. */
  private allyStampWhere(campaignId: string, allyCategoryId: string | null) {
    return {
      campaignId,
      status: 'ACTIVE' as const,
      OR: [
        { categoryId: null },
        ...(allyCategoryId ? [{ categoryId: allyCategoryId }] : []),
      ],
    };
  }

  /** El aliado otorga un sello al miembro (límite diario + advisory lock). */
  async grantStamp(user: AuthUser, dto: { passId?: string; qrToken?: string; programId: string }) {
    const ally = await this.getAllyForPortal(user);
    const campaign = await this.ensureLivingCampaign();
    const pass = dto.passId
      ? await this.prisma.pass.findFirst({ where: { id: dto.passId, tenantId: campaign.tenantId } })
      : await this.resolvePass(campaign.tenantId, dto.qrToken || '');
    if (!pass) throw new NotFoundException('Tarjeta no encontrada');

    await this.assertMembershipUsable(campaign.id, pass.customerId);

    const program = await this.prisma.stampProgram.findFirst({
      where: { id: dto.programId, campaignId: campaign.id, status: 'ACTIVE' },
    });
    if (!program) throw new NotFoundException('Programa no encontrado');
    if (program.categoryId && program.categoryId !== ally.categoryId) {
      throw new BadRequestException('Este negocio no participa en este programa');
    }

    const card = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        `SELECT pg_advisory_xact_lock(hashtext($1))`,
        `cuponera-stamp:${program.id}:${pass.customerId}`,
      );
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const recent = await tx.stampEvent.count({
        where: { programId: program.id, customerId: pass.customerId, action: 'STAMP', createdAt: { gte: since } },
      });
      if (recent >= program.maxPerDay) {
        throw new BadRequestException('Este miembro ya alcanzó el máximo de sellos de hoy');
      }
      const updated = await tx.stampCard.upsert({
        where: { programId_customerId: { programId: program.id, customerId: pass.customerId } },
        update: { stampsCount: { increment: 1 }, lastStampAt: new Date() },
        create: {
          campaignId: campaign.id,
          programId: program.id,
          customerId: pass.customerId,
          stampsCount: 1,
          lastStampAt: new Date(),
        },
      });
      await tx.stampEvent.create({
        data: {
          campaignId: campaign.id,
          programId: program.id,
          customerId: pass.customerId,
          allyBusinessId: ally.id,
          operatorUserId: user.id,
          action: 'STAMP',
        },
      });
      return updated;
    });

    return {
      ok: true,
      stampsCount: card.stampsCount,
      stampsRequired: program.stampsRequired,
      rewardReady: card.stampsCount >= program.stampsRequired,
    };
  }

  /** El aliado canjea el premio (resta stampsRequired, suma ciclo). */
  async redeemStampReward(user: AuthUser, dto: { passId?: string; qrToken?: string; programId: string }) {
    const ally = await this.getAllyForPortal(user);
    const campaign = await this.ensureLivingCampaign();
    const pass = dto.passId
      ? await this.prisma.pass.findFirst({ where: { id: dto.passId, tenantId: campaign.tenantId } })
      : await this.resolvePass(campaign.tenantId, dto.qrToken || '');
    if (!pass) throw new NotFoundException('Tarjeta no encontrada');

    // Faltaba: entregar el premio de sellos era el ÚNICO canje que no miraba la
    // membresía. Un miembro dado de baja podía seguir cobrando premios.
    await this.assertMembershipUsable(campaign.id, pass.customerId);

    const program = await this.prisma.stampProgram.findFirst({
      where: { id: dto.programId, campaignId: campaign.id },
    });
    if (!program) throw new NotFoundException('Programa no encontrado');
    if (program.categoryId && program.categoryId !== ally.categoryId) {
      throw new BadRequestException('Este negocio no participa en este programa');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        `SELECT pg_advisory_xact_lock(hashtext($1))`,
        `cuponera-stamp:${program.id}:${pass.customerId}`,
      );
      const card = await tx.stampCard.findUnique({
        where: { programId_customerId: { programId: program.id, customerId: pass.customerId } },
      });
      if (!card || card.stampsCount < program.stampsRequired) {
        throw new BadRequestException('El miembro aún no completa los sellos');
      }
      await tx.stampCard.update({
        where: { programId_customerId: { programId: program.id, customerId: pass.customerId } },
        data: { stampsCount: { decrement: program.stampsRequired }, cyclesCompleted: { increment: 1 } },
      });
      await tx.stampEvent.create({
        data: {
          campaignId: campaign.id,
          programId: program.id,
          customerId: pass.customerId,
          allyBusinessId: ally.id,
          operatorUserId: user.id,
          action: 'REDEEM',
        },
      });
    });

    return { ok: true, rewardText: program.rewardText };
  }

  /** Progreso de sellos del miembro por teléfono (vista pública "Mis sellos"). */
  async stampsByPhone(phoneRaw: string) {
    const campaign = await this.ensureLivingCampaign();
    const digits = (phoneRaw || '').replace(/\D/g, '');
    if (digits.length < 7) return { programs: [] };
    const tail = digits.slice(-10);
    const customers = await this.prisma.customer.findMany({
      where: { tenantId: campaign.tenantId, phone: { contains: tail } },
      select: { id: true },
    });
    if (!customers.length) return { programs: [] };
    const programs = await this.prisma.stampProgram.findMany({
      where: { campaignId: campaign.id, status: 'ACTIVE' },
      orderBy: { createdAt: 'desc' },
    });
    const cards = await this.prisma.stampCard.findMany({
      where: { customerId: { in: customers.map((c) => c.id) }, programId: { in: programs.map((p) => p.id) } },
    });
    return {
      programs: programs.map((p) => {
        const card = cards.find((c) => c.programId === p.id);
        return {
          id: p.id,
          name: p.name,
          rewardText: p.rewardText,
          stampsCount: card?.stampsCount ?? 0,
          stampsRequired: p.stampsRequired,
        };
      }),
    };
  }

  // ---------------------------------------------------------------------------
  // Geopush + Push (Fase 4)
  // ---------------------------------------------------------------------------

  /** Geopush = Location del tenant de sistema → geofence embebido en TODOS los
   *  pases de los miembros (Apple/Google muestran el aviso al acercarse). */
  async listGeopush() {
    const campaign = await this.ensureLivingCampaign();
    return this.locations.list(this.sysUser(), campaign.tenantId);
  }

  async createGeopush(dto: {
    name: string;
    latitude: number;
    longitude: number;
    radiusMeters?: number;
    walletRelevantText?: string;
    address?: string;
  }) {
    const campaign = await this.ensureLivingCampaign();
    return this.locations.create(this.sysUser(), dto, campaign.tenantId);
  }

  private async assertGeopush(campaignTenantId: string, id: string) {
    const loc = await this.prisma.location.findFirst({
      where: { id, tenantId: campaignTenantId },
    });
    if (!loc) throw new NotFoundException('Punto de geopush no encontrado');
    return loc;
  }

  async updateGeopush(
    id: string,
    dto: Partial<{
      name: string;
      latitude: number;
      longitude: number;
      radiusMeters: number;
      walletRelevantText: string;
      address: string;
    }>,
  ) {
    const campaign = await this.ensureLivingCampaign();
    await this.assertGeopush(campaign.tenantId, id);
    return this.locations.update(this.sysUser(), id, dto);
  }

  async deleteGeopush(id: string) {
    const campaign = await this.ensureLivingCampaign();
    await this.assertGeopush(campaign.tenantId, id);
    return this.locations.remove(this.sysUser(), id);
  }

  /** Push GENERAL a toda la comunidad (broadcast a los pases de la Living Card).
   *  Reusa NotificationsService (crea la Notification + push Apple/Google). */
  async sendBroadcast(dto: { title: string; body: string; scheduledAt?: string }) {
    const campaign = await this.ensureLivingCampaign();
    const card = await this.ensureLivingCard(campaign);
    return this.notifications.send(
      this.sysUser(),
      { title: dto.title, body: dto.body, cardId: card.id, scheduledAt: dto.scheduledAt } as any,
      campaign.tenantId,
    );
  }

  async listNotifications() {
    const campaign = await this.ensureLivingCampaign();
    return this.notifications.list(this.sysUser(), campaign.tenantId);
  }

  /** Resuelve los customerIds de un segmento. */
  private async resolveSegment(
    campaignId: string,
    seg: { planId?: string; allyId?: string },
  ): Promise<string[]> {
    if (seg.planId) {
      const ms = await this.prisma.livingMembership.findMany({
        where: { campaignId, planId: seg.planId, status: 'ACTIVE' },
        select: { customerId: true },
      });
      return ms.map((m) => m.customerId);
    }
    if (seg.allyId) {
      // Miembros que interactuaron con el negocio (canjes o sellos).
      const [reds, stamps] = await Promise.all([
        this.prisma.redemption.findMany({
          where: { allyBusinessId: seg.allyId },
          distinct: ['customerId'],
          select: { customerId: true },
        }),
        this.prisma.stampEvent.findMany({
          where: { allyBusinessId: seg.allyId },
          distinct: ['customerId'],
          select: { customerId: true },
        }),
      ]);
      return Array.from(new Set([...reds.map((r) => r.customerId), ...stamps.map((s) => s.customerId)]));
    }
    return [];
  }

  /** Push a un SEGMENTO (por plan o por negocio). Crea una Notification por
   *  cliente (customerId → lastMessage correcto) y push Apple/Google por pase. */
  async sendSegmentPush(dto: { planId?: string; allyId?: string; title: string; body: string }) {
    const campaign = await this.ensureLivingCampaign();
    const card = await this.ensureLivingCard(campaign);
    if (!dto.planId && !dto.allyId) {
      throw new BadRequestException('Falta el segmento (planId o allyId)');
    }
    const customerIds = await this.resolveSegment(campaign.id, dto);
    if (customerIds.length === 0) return { ok: true, targeted: 0, sent: 0 };

    const passes = await this.prisma.pass.findMany({
      where: { tenantId: campaign.tenantId, customerId: { in: customerIds }, status: 'ACTIVE' },
      select: { id: true, customerId: true },
    });

    let sent = 0;
    for (const p of passes) {
      // Notification ANTES del push (Apple lee lastMessage por customerId).
      await this.prisma.notification
        .create({
          data: {
            tenantId: campaign.tenantId,
            cardId: card.id,
            customerId: p.customerId,
            title: dto.title,
            body: dto.body,
            triggerType: 'MANUAL',
            sentAt: new Date(),
            stats: { targeted: 1, delivered: 0, segment: dto.planId ? 'plan' : 'ally' } as any,
          },
        })
        .catch(() => null);
      try {
        await this.wallet.pushPassUpdate(p.id, {
          message: { header: dto.title, body: dto.body },
        });
        sent++;
      } catch {
        /* un pase que falla no corta el envío al resto */
      }
    }
    return { ok: true, targeted: passes.length, sent };
  }

  // ---------------------------------------------------------------------------

  private slugify(s: string): string {
    return (s || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'cat';
  }
}
