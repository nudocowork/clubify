import { ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { CardType } from '@prisma/client';
import { resolveWalletAdvanced } from '../common/white-label/wallet-advanced.util';
import { PrismaService } from '../common/prisma/prisma.service';
import { AuthUser } from '../common/decorators/current-user.decorator';
import { QueueService } from '../jobs/queue.service';

export type CardDto = {
  type: CardType;
  name: string;
  walletBrandName?: string | null; // #24
  description?: string;
  terms?: string;
  termsEnabled?: boolean;
  dataPolicyEnabled?: boolean;
  primaryColor?: string;
  secondaryColor?: string;
  stampActiveColor?: string | null;
  stampInactiveColor?: string | null;
  stampContourColor?: string | null;
  centerBgColor?: string | null;
  logoBgColor?: string | null;
  logoShape?: string | null;
  stampBgType?: 'GRADIENT' | 'SOLID' | 'IMAGE';
  stampBgImageUrl?: string | null;
  stampIconImageUrl?: string | null;
  logoUrl?: string;
  heroImageUrl?: string;
  iconUrl?: string;
  stampsRequired?: number;
  rewardText?: string;
  pointsPerCurrency?: number;
  discountPercent?: number;
  cashbackPercent?: number | null;
  cashbackMinPurchase?: number | null;
  minAmountPerStamp?: number | null;
  visitsRequired?: number | null;
  tiers?: Array<{
    name: string;
    threshold: number;
    perks?: string[];
    color?: string;
    icon?: string;
  }>;
  tierMetric?: 'spend' | 'visits' | 'stamps';
  validFrom?: string | null;
  validUntil?: string | null;
  validDaysAfterIssue?: number | null;
  locationId?: string | null;
  howToEarnText?: string;
  businessName?: string;
  rewardDescText?: string;
  stampEarnedMessage?: string;
  rewardEarnedMessage?: string;
  multiRewards?: Array<{ at: number; reward: string }>;
  freeRewards?: Array<{
    id?: string;
    pos: number;
    text?: string;
    emoji?: string;
    circleColor?: string;
    textColor?: string;
    active?: boolean;
  }>;
  activeLinks?: Array<{ type: string; url: string; label: string }>;
  socialLinks?: Record<string, string>;
  stampIcon?: string;
  isActive?: boolean;
  transformIntoCardId?: string | null;
  transformOnRedeem?: boolean;
};

@Injectable()
export class CardsService {
  private logger = new Logger(CardsService.name);

  constructor(
    private prisma: PrismaService,
    private queue: QueueService,
  ) {}

  /** Campos del Card que se reflejan visualmente en el pass wallet.
   * Cuando alguno cambia, encolamos un wallet.push para cada pass activo
   * para que Apple Wallet y Google Wallet del cliente vean el cambio.
   */
  private static VISUAL_FIELDS = [
    'primaryColor',
    'secondaryColor',
    'stampActiveColor',
    'stampInactiveColor',
    'stampContourColor',
    'centerBgColor',
    'logoBgColor',
    'logoShape',
    'stampBgType',
    'stampBgImageUrl',
    'logoUrl',
    'walletBrandName',
    'heroImageUrl',
    'iconUrl',
    'stampIcon',
    'stampIconImageUrl',
    'name',
    'rewardText',
    'rewardDescText',
    'howToEarnText',
    'businessName',
    'terms',
    'termsEnabled',
    'activeLinks',
    'freeRewards',
  ] as const;

  /** Wallet V3 — normaliza/sanea los Premios Free antes de persistir.
   * Filtra posiciones inválidas (pos<1 o pos>stampsRequired, que nunca se
   * dibujarían), recorta textos, valida hex, asigna id. Ilimitados: no hay tope
   * de cantidad. Devuelve ordenado por posición. */
  private sanitizeFreeRewards(
    raw: CardDto['freeRewards'] | undefined,
    stampsRequired?: number | null,
  ): Array<{
    id: string;
    pos: number;
    text: string;
    emoji: string;
    circleColor: string | null;
    textColor: string | null;
    active: boolean;
  }> | undefined {
    if (raw === undefined) return undefined;
    if (!Array.isArray(raw)) return [];
    const isHex = (v: unknown): v is string =>
      typeof v === 'string' && /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(v.trim());
    const seenPos = new Set<number>();
    const maxPos =
      typeof stampsRequired === 'number' && stampsRequired > 0
        ? stampsRequired
        : Number.MAX_SAFE_INTEGER;
    const out = raw
      .map((r) => {
        const pos = Math.floor(Number((r as any)?.pos));
        // Fuera de rango (pos<1 o pos>máximo de sellos) → se descarta: un premio
        // más allá del máximo nunca se dibuja en la grilla.
        if (!Number.isFinite(pos) || pos < 1 || pos > maxPos) return null;
        return {
          id: typeof (r as any)?.id === 'string' && (r as any).id ? (r as any).id : randomUUID(),
          pos,
          text: String((r as any)?.text ?? '').trim().slice(0, 24),
          emoji: String((r as any)?.emoji ?? '').trim().slice(0, 8),
          circleColor: isHex((r as any)?.circleColor) ? (r as any).circleColor.trim() : null,
          textColor: isHex((r as any)?.textColor) ? (r as any).textColor.trim() : null,
          active: (r as any)?.active === undefined ? true : !!(r as any).active,
        };
      })
      .filter((r): r is NonNullable<typeof r> => r !== null)
      // Una posición no puede tener dos premios: gana el primero.
      .filter((r) => {
        if (seenPos.has(r.pos)) return false;
        seenPos.add(r.pos);
        return true;
      })
      .sort((a, b) => a.pos - b.pos);
    return out;
  }

  /** Wallet V3 — gate por MARCA. Si la marca del negocio apagó una función en
   * "Wallet Avanzado", la neutralizamos aquí (además del gate del editor), para
   * que ni un POST directo pueda saltarse el permiso. Aislado: se consulta la
   * marca por el tenant. Muta el dto en sitio ANTES de persistir. */
  private async gateCardWalletFeatures(tenantId: string, dto: Partial<CardDto>) {
    const touchesImage = dto.stampBgType === 'IMAGE' || dto.stampBgImageUrl != null;
    const touchesFree = dto.freeRewards !== undefined && (dto.freeRewards?.length ?? 0) > 0;
    if (!touchesImage && !touchesFree) return;
    const t = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { whiteLabel: { select: { walletAdvanced: true } } },
    });
    const wa = resolveWalletAdvanced(t?.whiteLabel?.walletAdvanced);
    if (touchesImage && !wa.customBackgrounds) {
      if (dto.stampBgType === 'IMAGE') dto.stampBgType = 'SOLID';
      dto.stampBgImageUrl = null;
    }
    if (touchesFree && !wa.freeRewards) {
      dto.freeRewards = [];
    }
  }

  private resolveTenantId(user: AuthUser, tenantIdParam?: string) {
    if (user.role === 'SUPER_ADMIN') {
      if (!tenantIdParam) throw new ForbiddenException('tenantId required for super admin');
      return tenantIdParam;
    }
    if (!user.tenantId) throw new ForbiddenException('User has no tenant');
    return user.tenantId;
  }

  /**
   * Las tarjetas del negocio, SIN la plantilla de las alianzas.
   *
   * Esa plantilla no es una tarjeta que el dueño haya creado ni que gestione
   * desde aquí: es la fontanería del pase de un convenio. Todo lo suyo —los
   * beneficios, los dos enlaces, los empleados, los interruptores— vive en
   * Alianzas, y aquí no hacía más que invitar a errores: se le ofrecía su
   * enlace de alta genérico (que se salta el código de la empresa), el botón de
   * borrar (que se lleva por delante los pases de todos sus empleados), y salía
   * como destino en la tienda, en los pop-ups del menú, en los QR de mostrador
   * y en el segmentador de notificaciones.
   *
   * Este listado lo consumen once pantallas del panel. Filtrar aquí las limpia
   * todas de una vez, en vez de repetir la condición en cada una.
   *
   * La excepción es la propia pantalla de Tarjetas, que pide `especiales=1`
   * cuando el dueño elige el filtro «Alianzas» o «Club»: ahí sí quiere verlas,
   * y desde ahí se le manda a su sección de verdad, no a la ficha de tarjeta.
   */
  list(user: AuthUser, tenantId?: string, especiales = false) {
    const tid = this.resolveTenantId(user, tenantId);
    return this.prisma.card.findMany({
      // `especiales` solo lo pide la pantalla de Tarjetas, y solo cuando el
      // dueño elige el filtro «Alianzas» o «Club». Las otras diez pantallas
      // que consumen este listado siguen sin verlas.
      where: { tenantId: tid, ...(especiales ? {} : { convenioId: null }) },
      include: {
        _count: { select: { passes: true } },
        location: { select: { id: true, name: true } },
        utmLinks: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async get(user: AuthUser, id: string) {
    const card = await this.prisma.card.findUnique({
      where: { id },
      include: {
        _count: { select: { passes: true } },
        location: { select: { id: true, name: true } },
        utmLinks: true,
      },
    });
    if (!card) throw new NotFoundException('Card');
    if (user.role !== 'SUPER_ADMIN' && card.tenantId !== user.tenantId) {
      throw new ForbiddenException();
    }
    return card;
  }

  async create(user: AuthUser, dto: CardDto, tenantId?: string) {
    const tid = this.resolveTenantId(user, tenantId);
    // Validamos que la sede pertenezca al tenant si vino seteada.
    if (dto.locationId) {
      const loc = await this.prisma.location.findUnique({
        where: { id: dto.locationId },
        select: { tenantId: true },
      });
      if (!loc || loc.tenantId !== tid) {
        throw new ForbiddenException('Location does not belong to tenant');
      }
    }
    await this.gateCardWalletFeatures(tid, dto);
    return this.prisma.card.create({
      data: {
        tenantId: tid,
        type: dto.type,
        name: dto.name,
        walletBrandName: dto.walletBrandName ?? null,
        description: dto.description ?? '',
        terms: dto.terms ?? '',
        termsEnabled: dto.termsEnabled ?? true,
        dataPolicyEnabled: dto.dataPolicyEnabled ?? true,
        primaryColor: dto.primaryColor ?? '#0F3D2E',
        secondaryColor: dto.secondaryColor ?? '#2E7D5B',
        stampActiveColor: dto.stampActiveColor ?? undefined,
        stampInactiveColor: dto.stampInactiveColor ?? undefined,
        stampContourColor: dto.stampContourColor ?? undefined,
        centerBgColor: dto.centerBgColor ?? undefined,
        logoBgColor: dto.logoBgColor ?? undefined,
        logoShape: dto.logoShape ?? undefined,
        // Wallet V3 — tarjetas NUEVAS nacen con color uniforme (SOLID, default
        // del schema); las existentes quedaron en GRADIENT por la migración.
        stampBgType: dto.stampBgType ?? undefined,
        stampBgImageUrl: dto.stampBgImageUrl ?? undefined,
        stampIconImageUrl: dto.stampIconImageUrl ?? undefined,
        logoUrl: dto.logoUrl,
        heroImageUrl: dto.heroImageUrl,
        iconUrl: dto.iconUrl,
        stampsRequired: dto.stampsRequired,
        rewardText: dto.rewardText ?? '',
        pointsPerCurrency: dto.pointsPerCurrency,
        discountPercent: dto.discountPercent,
        cashbackPercent: dto.cashbackPercent ?? undefined,
        cashbackMinPurchase: dto.cashbackMinPurchase ?? undefined,
        minAmountPerStamp: dto.minAmountPerStamp ?? undefined,
        visitsRequired: dto.visitsRequired ?? undefined,
        tiers: (dto.tiers ?? []) as any,
        tierMetric: dto.tierMetric ?? 'spend',
        validFrom: dto.validFrom ? new Date(dto.validFrom) : undefined,
        validUntil: dto.validUntil ? new Date(dto.validUntil) : undefined,
        validDaysAfterIssue: dto.validDaysAfterIssue ?? undefined,
        locationId: dto.locationId ?? undefined,
        howToEarnText: dto.howToEarnText ?? '',
        businessName: dto.businessName ?? '',
        rewardDescText: dto.rewardDescText ?? '',
        stampEarnedMessage: dto.stampEarnedMessage ?? '',
        rewardEarnedMessage: dto.rewardEarnedMessage ?? '',
        multiRewards: (dto.multiRewards ?? []) as any,
        freeRewards: (this.sanitizeFreeRewards(dto.freeRewards, dto.stampsRequired) ?? []) as any,
        activeLinks: (dto.activeLinks ?? []) as any,
        socialLinks: dto.socialLinks ?? {},
        stampIcon: dto.stampIcon ?? '☕',
        transformIntoCardId: dto.transformIntoCardId ?? undefined,
        transformOnRedeem: dto.transformOnRedeem ?? undefined,
      },
    });
  }

  async update(user: AuthUser, id: string, dto: Partial<CardDto>) {
    const existing = await this.get(user, id);
    // Defensivo: un POST manual podría dejar el cupón apuntando a sí mismo.
    // resolveOrCreateStampsCard filtra por type='STAMPS' (el cupón nunca
    // matchea), pero ya que estamos, rechazamos la auto-referencia para
    // evitar confusión en futuras refactors.
    if (dto.transformIntoCardId === id) {
      throw new ForbiddenException(
        'transformIntoCardId no puede apuntar al mismo card',
      );
    }
    if (dto.locationId) {
      const loc = await this.prisma.location.findUnique({
        where: { id: dto.locationId },
        select: { tenantId: true },
      });
      if (!loc || loc.tenantId !== existing.tenantId) {
        throw new ForbiddenException('Location does not belong to tenant');
      }
    }
    await this.gateCardWalletFeatures(existing.tenantId, dto);
    // null en estos campos significa "borrar"; undefined = "no tocar".
    const data: any = { ...dto };
    if ('validFrom' in dto) {
      data.validFrom = dto.validFrom ? new Date(dto.validFrom) : null;
    }
    if ('validUntil' in dto) {
      data.validUntil = dto.validUntil ? new Date(dto.validUntil) : null;
    }
    if ('validDaysAfterIssue' in dto) {
      data.validDaysAfterIssue = dto.validDaysAfterIssue ?? null;
    }
    if ('locationId' in dto) {
      data.locationId = dto.locationId ?? null;
    }
    for (const k of [
      'stampActiveColor',
      'stampInactiveColor',
      'stampContourColor',
      'centerBgColor',
      'logoBgColor',
      'logoShape',
      'stampBgImageUrl',
      'stampIconImageUrl',
      'cashbackPercent',
      'cashbackMinPurchase',
      'minAmountPerStamp',
      'visitsRequired',
      'transformIntoCardId',
    ] as const) {
      if (k in dto) data[k] = dto[k] ?? null;
    }
    if ('tiers' in dto) data.tiers = (dto.tiers ?? []) as any;
    if ('freeRewards' in dto) {
      data.freeRewards = (this.sanitizeFreeRewards(
        dto.freeRewards,
        dto.stampsRequired ?? existing.stampsRequired,
      ) ?? []) as any;
    }
    const updated = await this.prisma.card.update({ where: { id }, data });

    // Auto-sync: si el cambio tocó algún campo visual del pass, encolamos
    // wallet.push para cada pass activo de esta card. Esto pushea silencioso
    // a Apple Wallet (APNs) y hace PATCH al LoyaltyObject de Google Wallet
    // para que los clientes vean el cambio sin re-instalar la tarjeta.
    const visualChanged = CardsService.VISUAL_FIELDS.some((k) => k in dto);
    if (visualChanged) {
      this.enqueuePassPushForCard(id).catch((e) => {
        this.logger.warn(
          `Auto-sync pass push for card ${id} falló: ${(e as Error).message}`,
        );
      });
    }

    return updated;
  }

  private async enqueuePassPushForCard(cardId: string) {
    const passes = await this.prisma.pass.findMany({
      where: { cardId, status: 'ACTIVE' },
      select: { id: true },
    });
    if (passes.length === 0) return;
    // FIX 2026-06-16 (review #22): bumpeamos lastActivityAt — el cache-bust
    // del strip/hero/logo de Google Wallet usa ?v=lastActivityAt. Sin esto,
    // cambiar color/hero/logo se pusheaba pero Google servía la imagen
    // cacheada (el PATCH no fuerza re-fetch). Mismo patrón que el refresh
    // global (tenants.service / passes.controller).
    await this.prisma.pass.updateMany({
      where: { cardId, status: 'ACTIVE' },
      data: { lastActivityAt: new Date() },
    });
    this.logger.log(
      `Auto-sync: encolando wallet.push para ${passes.length} pass(es) de card ${cardId}`,
    );
    for (const p of passes) {
      await this.queue.enqueue('wallet.push', {
        passId: p.id,
        reason: 'card_visual_update',
      } as any);
    }
  }

  async remove(user: AuthUser, id: string) {
    const card = await this.get(user, id);

    // La tarjeta-plantilla de un plan de club no se borra desde aquí. Borrarla
    // arrastraba en cascada TODOS los pases del plan (`Pass.cardId` es
    // `onDelete: Cascade`) y dejaba a los socios con `passId` en null y sin
    // forma de reemitir: cada consumo respondía «esta membresía todavía no
    // tiene tarjeta», para siempre. Y en el listado se ve como una tarjeta de
    // sellos cualquiera, así que es un clic fácil de dar por error.
    if (card.clubPlanId) {
      throw new ForbiddenException(
        'Esta tarjeta es la de un plan de club. Apaga el plan desde Tarjeta de Club; borrarla dejaría a sus socios sin tarjeta.',
      );
    }

    // Y tampoco la plantilla de una ALIANZA, donde el daño es todavía peor:
    // `ConvenioTarjeta.passId` NO tiene clave foránea, así que la cascada se
    // lleva los pases y deja las filas apuntando a pases muertos. El canje
    // busca por `passId`, así que ninguno de esos empleados vuelve a
    // encontrarse — y no hay forma de reemitirlos.
    if (card.convenioId) {
      throw new ForbiddenException(
        'Esta tarjeta es la de una alianza. Finalízala desde Alianzas; borrarla dejaría a sus empleados sin tarjeta y sin forma de recuperarla.',
      );
    }

    await this.prisma.card.delete({ where: { id } });
    return { ok: true };
  }
}
