import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  BroadcastAudience,
  BroadcastColor,
  BroadcastIcon,
  BroadcastKind,
  BroadcastMediaKind,
  Prisma,
  Role,
} from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { AuthUser } from '../common/decorators/current-user.decorator';

export type CreateBroadcastDto = {
  kind: BroadcastKind;
  title: string;
  description: string;
  audience?: BroadcastAudience;
  isActive?: boolean;

  // BANNER-only
  color?: BroadcastColor | null;
  customColor?: string | null;
  icon?: BroadcastIcon | null;
  ctaLabel?: string | null;
  ctaUrl?: string | null;

  // LOGIN_POPUP-only
  mediaKind?: BroadcastMediaKind | null;
  mediaUrl?: string | null;
  confirmLabel?: string | null;

  startsAt?: string | Date | null;
  endsAt?: string | Date | null;
};

export type UpdateBroadcastDto = Partial<CreateBroadcastDto>;

export type ListBroadcastFilters = {
  kind?: BroadcastKind;
  isActive?: boolean;
  audience?: BroadcastAudience;
};

// Mapeo entre rol del user autenticado y las audiences a las que aplica.
// ALL siempre matchea. Vendors ven AMBASSADORS también porque trabajan
// dentro del equipo del embajador y el SUPER_ADMIN puede querer comunicar
// algo "a todo el equipo del embajador" sin distinguir.
function audiencesForRole(role: Role): BroadcastAudience[] {
  switch (role) {
    case 'AFFILIATE_INFLUENCER':
      return ['ALL', 'INFLUENCERS'];
    case 'AFFILIATE_AMBASSADOR':
    case 'AFFILIATE_SOCIO':
      return ['ALL', 'AMBASSADORS'];
    case 'AFFILIATE_VENDOR':
      return ['ALL', 'VENDORS', 'AMBASSADORS'];
    default:
      return ['ALL'];
  }
}

function isSuperAdmin(role: Role | null | undefined) {
  return role === 'SUPER_ADMIN';
}

function toDateOrNull(v: string | Date | null | undefined): Date | null {
  if (v === undefined) return null;
  if (v === null) return null;
  return typeof v === 'string' ? new Date(v) : v;
}

@Injectable()
export class BroadcastsService {
  constructor(private prisma: PrismaService) {}

  // -----------------------------------------------------------------------
  // ADMIN
  // -----------------------------------------------------------------------

  async list(user: AuthUser, filters: ListBroadcastFilters = {}) {
    if (!isSuperAdmin(user.role)) throw new ForbiddenException();
    const where: Prisma.BroadcastWhereInput = {};
    if (filters.kind) where.kind = filters.kind;
    if (filters.audience) where.audience = filters.audience;
    if (typeof filters.isActive === 'boolean') where.isActive = filters.isActive;

    const items = await this.prisma.broadcast.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        createdBy: { select: { id: true, fullName: true, email: true } },
        _count: { select: { reads: true } },
      },
    });
    return items;
  }

  async get(user: AuthUser, id: string) {
    if (!isSuperAdmin(user.role)) throw new ForbiddenException();
    const b = await this.prisma.broadcast.findUnique({
      where: { id },
      include: {
        createdBy: { select: { id: true, fullName: true, email: true } },
        _count: { select: { reads: true } },
      },
    });
    if (!b) throw new NotFoundException('Broadcast no encontrado');
    return b;
  }

  async create(user: AuthUser, dto: CreateBroadcastDto) {
    if (!isSuperAdmin(user.role)) throw new ForbiddenException();
    if (!dto.title?.trim()) throw new ForbiddenException('Falta el título');
    if (!dto.description?.trim())
      throw new ForbiddenException('Falta la descripción');

    return this.prisma.broadcast.create({
      data: {
        kind: dto.kind,
        title: dto.title.trim(),
        description: dto.description,
        audience: dto.audience ?? 'ALL',
        isActive: dto.isActive ?? true,
        color: dto.color ?? null,
        customColor: dto.customColor ?? null,
        icon: dto.icon ?? null,
        ctaLabel: dto.ctaLabel ?? null,
        ctaUrl: dto.ctaUrl ?? null,
        mediaKind: dto.mediaKind ?? null,
        mediaUrl: dto.mediaUrl ?? null,
        confirmLabel: dto.confirmLabel ?? 'He leído',
        startsAt: toDateOrNull(dto.startsAt),
        endsAt: toDateOrNull(dto.endsAt),
        createdById: user.id,
      },
    });
  }

  async update(user: AuthUser, id: string, dto: UpdateBroadcastDto) {
    if (!isSuperAdmin(user.role)) throw new ForbiddenException();
    const existing = await this.prisma.broadcast.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Broadcast no encontrado');

    return this.prisma.broadcast.update({
      where: { id },
      data: {
        kind: dto.kind ?? undefined,
        title: dto.title?.trim() ?? undefined,
        description: dto.description ?? undefined,
        audience: dto.audience ?? undefined,
        isActive: dto.isActive ?? undefined,
        color: dto.color === undefined ? undefined : dto.color,
        customColor:
          dto.customColor === undefined ? undefined : dto.customColor,
        icon: dto.icon === undefined ? undefined : dto.icon,
        ctaLabel: dto.ctaLabel === undefined ? undefined : dto.ctaLabel,
        ctaUrl: dto.ctaUrl === undefined ? undefined : dto.ctaUrl,
        mediaKind: dto.mediaKind === undefined ? undefined : dto.mediaKind,
        mediaUrl: dto.mediaUrl === undefined ? undefined : dto.mediaUrl,
        confirmLabel:
          dto.confirmLabel === undefined ? undefined : dto.confirmLabel,
        startsAt:
          dto.startsAt === undefined ? undefined : toDateOrNull(dto.startsAt),
        endsAt: dto.endsAt === undefined ? undefined : toDateOrNull(dto.endsAt),
      },
    });
  }

  async disable(user: AuthUser, id: string) {
    if (!isSuperAdmin(user.role)) throw new ForbiddenException();
    const existing = await this.prisma.broadcast.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Broadcast no encontrado');
    return this.prisma.broadcast.update({
      where: { id },
      data: { isActive: false },
    });
  }

  /**
   * Métricas de lectura. "sent" = cantidad de users elegibles para esta
   * pieza (en base a audience). "read" = users que ya marcaron leído.
   * "pending" y "rate" derivados.
   */
  async metricsFor(user: AuthUser, id: string) {
    if (!isSuperAdmin(user.role)) throw new ForbiddenException();
    const b = await this.prisma.broadcast.findUnique({
      where: { id },
      select: { id: true, audience: true },
    });
    if (!b) throw new NotFoundException('Broadcast no encontrado');

    const roleFilter = audienceToRoles(b.audience);
    const [sent, read] = await Promise.all([
      this.prisma.user.count({
        where: { isActive: true, role: { in: roleFilter } },
      }),
      this.prisma.broadcastRead.count({ where: { broadcastId: id } }),
    ]);

    const pending = Math.max(0, sent - read);
    const rate = sent > 0 ? read / sent : 0;
    return { sent, read, pending, rate, audience: b.audience };
  }

  // -----------------------------------------------------------------------
  // PUBLIC AL USER AUTENTICADO
  // -----------------------------------------------------------------------

  /**
   * Banner activo para mostrar en el panel afiliado. Solo BANNER,
   * isActive=true, dentro de la ventana de vigencia opcional, dirigido al
   * rol del user, y que el user todavía NO descartó.
   */
  async getActiveBannerForUser(user: AuthUser) {
    const now = new Date();
    const audiences = audiencesForRole(user.role);

    // Banners ya descartados por este user (BroadcastRead = descartar/cerrar
    // para BANNER, "leído" para LOGIN_POPUP — reusamos el modelo).
    const dismissedIds = await this.prisma.broadcastRead.findMany({
      where: { userId: user.id },
      select: { broadcastId: true },
    });
    const dismissedSet = new Set(dismissedIds.map((r) => r.broadcastId));

    const candidates = await this.prisma.broadcast.findMany({
      where: {
        kind: 'BANNER',
        isActive: true,
        audience: { in: audiences },
        AND: [
          { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
          { OR: [{ endsAt: null }, { endsAt: { gte: now } }] },
        ],
      },
      orderBy: { createdAt: 'desc' },
    });

    const visible = candidates.find((b) => !dismissedSet.has(b.id));
    return visible ?? null;
  }

  /**
   * Popup pendiente para el user — el más antiguo que aún no leyó. Solo
   * LOGIN_POPUP, activo, en vigencia, audiencia del rol. Una vez registrada
   * la lectura, este endpoint deja de devolverlo.
   */
  async getPendingLoginPopupForUser(user: AuthUser) {
    const now = new Date();
    const audiences = audiencesForRole(user.role);

    const readIds = await this.prisma.broadcastRead.findMany({
      where: { userId: user.id },
      select: { broadcastId: true },
    });
    const readSet = new Set(readIds.map((r) => r.broadcastId));

    const candidates = await this.prisma.broadcast.findMany({
      where: {
        kind: 'LOGIN_POPUP',
        isActive: true,
        audience: { in: audiences },
        AND: [
          { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
          { OR: [{ endsAt: null }, { endsAt: { gte: now } }] },
        ],
      },
      orderBy: { createdAt: 'asc' },
    });

    const pending = candidates.find((b) => !readSet.has(b.id));
    return pending ?? null;
  }

  /**
   * Upsert idempotente — si ya existe el registro, no falla ni duplica.
   * Para BANNER significa "descartar"; para LOGIN_POPUP significa "leído".
   */
  async markRead(broadcastId: string, userId: string) {
    const exists = await this.prisma.broadcast.findUnique({
      where: { id: broadcastId },
      select: { id: true },
    });
    if (!exists) throw new NotFoundException('Broadcast no encontrado');

    await this.prisma.broadcastRead.upsert({
      where: { broadcastId_userId: { broadcastId, userId } },
      create: { broadcastId, userId },
      update: {},
    });
    return { ok: true };
  }
}

/**
 * Helper interno — convierte la audience configurada al set de Role del
 * sistema que la satisface. Usado por metricsFor para calcular "sent".
 */
function audienceToRoles(audience: BroadcastAudience): Role[] {
  switch (audience) {
    case 'INFLUENCERS':
      return ['AFFILIATE_INFLUENCER'];
    case 'AMBASSADORS':
      return ['AFFILIATE_AMBASSADOR', 'AFFILIATE_SOCIO'];
    case 'VENDORS':
      return ['AFFILIATE_VENDOR'];
    case 'ALL':
    default:
      return [
        'AFFILIATE_INFLUENCER',
        'AFFILIATE_AMBASSADOR',
        'AFFILIATE_SOCIO',
        'AFFILIATE_VENDOR',
      ];
  }
}
