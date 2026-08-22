import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import {
  brandAppUrl,
  BRAND_DOMAIN_SELECT,
} from '../email/brand-email-creds.util';
import { PrismaService } from '../common/prisma/prisma.service';
import { AuthUser } from '../common/decorators/current-user.decorator';
import { GrowBusinessService } from '../integrations/grow-business.service';
import {
  brandGrowCreds,
  BRAND_GROW_SELECT,
} from '../integrations/brand-sms-creds.util';
import { randomBytes } from 'crypto';

const APPT_STATUSES = [
  'pending',
  'confirmed',
  'completed',
  'cancelled',
  'no_show',
] as const;
type ApptStatus = (typeof APPT_STATUSES)[number];

// ─── Helpers de timezone (mismo algoritmo DST-safe que reservations.service) ───

/** (fecha YYYY-MM-DD, minutos desde medianoche) en la TZ del tenant → UTC. */
function localMinutesToUtc(
  dateStr: string,
  minutes: number,
  timezone: string,
): Date {
  const [y, mo, d] = dateStr.split('-').map(Number);
  const h = Math.floor(minutes / 60);
  const mi = minutes % 60;
  const asUtc = Date.UTC(y, mo - 1, d, h, mi, 0);
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const parts = fmt.formatToParts(new Date(asUtc));
  const get = (t: string) =>
    Number(parts.find((p) => p.type === t)?.value ?? 0);
  let tzH = get('hour');
  if (tzH === 24) tzH = 0;
  const projected = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    tzH,
    get('minute'),
    get('second'),
  );
  const offset = projected - asUtc;
  return new Date(asUtc - offset);
}

/** weekday (0=domingo … 6=sábado) de una fecha YYYY-MM-DD en la TZ del tenant. */
function weekdayInTz(dateStr: string, timezone: string): number {
  const [y, mo, d] = dateStr.split('-').map(Number);
  const noon = new Date(Date.UTC(y, mo - 1, d, 12, 0, 0));
  const wd = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'short',
  }).format(noon);
  const map: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  return map[wd] ?? 0;
}

/** 'YYYY-MM-DD' de un instante UTC en la timezone del tenant. */
function dateStrInTz(d: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function minutesToLabel(m: number): string {
  const h = Math.floor(m / 60);
  const mi = m % 60;
  return `${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}`;
}

function isValidDateStr(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

@Injectable()
export class ServiceReservationsService {
  private logger = new Logger(ServiceReservationsService.name);
  constructor(
    private prisma: PrismaService,
    private growBusiness: GrowBusinessService,
  ) {}

  private tid(user: AuthUser, override?: string): string {
    if (user.role === 'SUPER_ADMIN' || user.role === 'PLATFORM_OWNER') {
      if (!override) throw new ForbiddenException('tenantId requerido');
      return override;
    }
    if (!user.tenantId) throw new ForbiddenException();
    return user.tenantId;
  }

  // ───────────────── Config del panel ─────────────────

  async getConfig(user: AuthUser, override?: string) {
    const tid = this.tid(user, override);
    const [tenant, services, availability, providers] = await Promise.all([
      this.prisma.tenant.findUnique({
        where: { id: tid },
        select: { serviceReservationsEnabled: true, timezone: true, slug: true },
      }),
      this.prisma.service.findMany({
        where: { tenantId: tid },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      }),
      this.prisma.serviceAvailability.findMany({
        where: { tenantId: tid },
        orderBy: [{ weekday: 'asc' }, { startMin: 'asc' }],
      }),
      this.prisma.serviceProvider.findMany({
        where: { tenantId: tid },
        orderBy: [{ isActive: 'desc' }, { sortOrder: 'asc' }, { createdAt: 'asc' }],
      }),
    ]);
    return {
      enabled: tenant?.serviceReservationsEnabled ?? false,
      timezone: tenant?.timezone ?? 'America/Bogota',
      slug: tenant?.slug ?? null,
      services,
      availability,
      providers,
    };
  }

  // ───────────────── Profesionales (Fase 5) ─────────────────

  private async hasActiveProviders(tenantId: string): Promise<boolean> {
    const n = await this.prisma.serviceProvider.count({
      where: { tenantId, isActive: true },
    });
    return n > 0;
  }

  /** El cliente que agenda queda en la lista de Clientes del negocio: match por
   *  teléfono (exacto o últimos 10 dígitos) o crea uno nuevo. NO emite pase ni
   *  suma sello (respeta PDF734). Devuelve el id o null si no se pudo. */
  private async matchOrCreateCustomer(
    tenantId: string,
    fullName: string,
    phone: string,
  ): Promise<string | null> {
    const phoneNorm = (phone || '').replace(/\s/g, '').trim();
    if (phoneNorm.length < 6) return null;
    const last10 = phoneNorm.replace(/\D/g, '').slice(-10);
    let c = await this.prisma.customer
      .findUnique({ where: { tenantId_phone: { tenantId, phone: phoneNorm } } })
      .catch(() => null);
    if (!c && last10.length >= 8) {
      c = await this.prisma.customer
        .findFirst({ where: { tenantId, phone: { endsWith: last10 } } })
        .catch(() => null);
    }
    if (c) return c.id;
    try {
      const created = await this.prisma.customer.create({
        data: { tenantId, fullName: fullName || 'Cliente', phone: phoneNorm },
      });
      return created.id;
    } catch (e: any) {
      if (e?.code === 'P2002') {
        const again = await this.prisma.customer
          .findUnique({ where: { tenantId_phone: { tenantId, phone: phoneNorm } } })
          .catch(() => null);
        return again?.id ?? null;
      }
      return null;
    }
  }

  async listProviders(user: AuthUser, override?: string) {
    const tid = this.tid(user, override);
    return this.prisma.serviceProvider.findMany({
      where: { tenantId: tid },
      orderBy: [{ isActive: 'desc' }, { sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
  }

  async createProvider(user: AuthUser, name: string, override?: string) {
    const tid = this.tid(user, override);
    const clean = (name ?? '').trim();
    if (!clean) throw new BadRequestException('El nombre es obligatorio.');
    return this.prisma.serviceProvider.create({
      data: { tenantId: tid, name: clean },
    });
  }

  async updateProvider(
    user: AuthUser,
    id: string,
    dto: {
      name?: string;
      isActive?: boolean;
      sortOrder?: number;
      serviceIds?: string[];
    },
  ) {
    const tid = this.tid(user);
    const owned = await this.prisma.serviceProvider.findFirst({
      where: { id, tenantId: tid },
      select: { id: true },
    });
    if (!owned) throw new NotFoundException('Profesional no encontrado.');
    return this.prisma.serviceProvider.update({
      where: { id },
      data: {
        name: dto.name === undefined ? undefined : dto.name.trim(),
        isActive: dto.isActive === undefined ? undefined : dto.isActive,
        sortOrder: dto.sortOrder === undefined ? undefined : dto.sortOrder,
        serviceIds:
          dto.serviceIds === undefined
            ? undefined
            : dto.serviceIds.filter((x) => typeof x === 'string'),
      },
    });
  }

  async removeProvider(user: AuthUser, id: string) {
    const tid = this.tid(user);
    const owned = await this.prisma.serviceProvider.findFirst({
      where: { id, tenantId: tid },
      select: { id: true },
    });
    if (!owned) throw new NotFoundException('Profesional no encontrado.');
    // Borra el profesional y su disponibilidad. Las citas conservan providerId
    // (histórico) — quedan sin profesional "vivo" pero visibles en la agenda.
    await this.prisma.$transaction([
      this.prisma.serviceAvailability.deleteMany({
        where: { tenantId: tid, providerId: id },
      }),
      this.prisma.serviceProvider.delete({ where: { id } }),
    ]);
    return { ok: true };
  }

  // ───────────────── Servicios (CRUD) ─────────────────

  async listServices(user: AuthUser, override?: string) {
    const tid = this.tid(user, override);
    return this.prisma.service.findMany({
      where: { tenantId: tid },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
  }

  async createService(
    user: AuthUser,
    dto: {
      name: string;
      description?: string;
      durationMin: number;
      priceCents?: number | null;
    },
    override?: string,
  ) {
    const tid = this.tid(user, override);
    const name = (dto.name ?? '').trim();
    if (!name) throw new BadRequestException('El nombre es obligatorio.');
    const durationMin = Math.round(Number(dto.durationMin) || 0);
    if (durationMin < 5 || durationMin > 720) {
      throw new BadRequestException('La duración debe estar entre 5 y 720 min.');
    }
    return this.prisma.service.create({
      data: {
        tenantId: tid,
        name,
        description: dto.description?.trim() || null,
        durationMin,
        priceCents: dto.priceCents == null ? null : Math.round(dto.priceCents),
      },
    });
  }

  async updateService(
    user: AuthUser,
    id: string,
    dto: {
      name?: string;
      description?: string;
      durationMin?: number;
      priceCents?: number | null;
      isActive?: boolean;
      sortOrder?: number;
    },
  ) {
    const tid = this.tid(user);
    const owned = await this.prisma.service.findFirst({
      where: { id, tenantId: tid },
      select: { id: true },
    });
    if (!owned) throw new NotFoundException('Servicio no encontrado.');
    return this.prisma.service.update({
      where: { id },
      data: {
        name: dto.name === undefined ? undefined : dto.name.trim(),
        description:
          dto.description === undefined ? undefined : dto.description.trim() || null,
        durationMin:
          dto.durationMin === undefined
            ? undefined
            : Math.max(5, Math.min(720, Math.round(dto.durationMin))),
        priceCents:
          dto.priceCents === undefined
            ? undefined
            : dto.priceCents == null
              ? null
              : Math.round(dto.priceCents),
        isActive: dto.isActive === undefined ? undefined : dto.isActive,
        sortOrder: dto.sortOrder === undefined ? undefined : dto.sortOrder,
      },
    });
  }

  async removeService(user: AuthUser, id: string) {
    const tid = this.tid(user);
    const owned = await this.prisma.service.findFirst({
      where: { id, tenantId: tid },
      select: { id: true },
    });
    if (!owned) throw new NotFoundException('Servicio no encontrado.');
    await this.prisma.service.delete({ where: { id } });
    return { ok: true };
  }

  // ───────────────── Disponibilidad semanal ─────────────────

  /** Reemplaza el horario semanal del negocio (providerId null) o de UN
   *  profesional (Fase 5) por el set enviado. */
  async setAvailability(
    user: AuthUser,
    rows: { weekday: number; startMin: number; endMin: number }[],
    providerId?: string | null,
    override?: string,
  ) {
    const tid = this.tid(user, override);
    const pid = providerId || null;
    if (pid) {
      const owned = await this.prisma.serviceProvider.findFirst({
        where: { id: pid, tenantId: tid },
        select: { id: true },
      });
      if (!owned) throw new BadRequestException('Profesional no válido.');
    }
    const clean = (rows ?? [])
      .filter(
        (r) =>
          Number.isInteger(r.weekday) &&
          r.weekday >= 0 &&
          r.weekday <= 6 &&
          Number.isFinite(r.startMin) &&
          Number.isFinite(r.endMin) &&
          r.startMin >= 0 &&
          r.endMin <= 24 * 60 &&
          r.endMin > r.startMin,
      )
      .map((r) => ({
        tenantId: tid,
        providerId: pid,
        weekday: r.weekday,
        startMin: Math.round(r.startMin),
        endMin: Math.round(r.endMin),
      }));
    await this.prisma.$transaction([
      this.prisma.serviceAvailability.deleteMany({
        where: { tenantId: tid, providerId: pid },
      }),
      ...(clean.length
        ? [this.prisma.serviceAvailability.createMany({ data: clean })]
        : []),
    ]);
    return this.prisma.serviceAvailability.findMany({
      where: { tenantId: tid, providerId: pid },
      orderBy: [{ weekday: 'asc' }, { startMin: 'asc' }],
    });
  }

  // ───────────────── Excepciones (días puntuales) ─────────────────

  async listExceptions(user: AuthUser, override?: string) {
    const tid = this.tid(user, override);
    return this.prisma.serviceException.findMany({
      where: { tenantId: tid },
      orderBy: { date: 'asc' },
    });
  }

  async upsertException(
    user: AuthUser,
    dto: { date: string; closed: boolean; startMin?: number; endMin?: number },
    override?: string,
  ) {
    const tid = this.tid(user, override);
    if (!isValidDateStr(dto.date))
      throw new BadRequestException('Fecha inválida (YYYY-MM-DD).');
    const date = new Date(`${dto.date}T00:00:00.000Z`);
    const data = {
      closed: !!dto.closed,
      startMin: dto.closed ? null : (dto.startMin ?? null),
      endMin: dto.closed ? null : (dto.endMin ?? null),
    };
    const existing = await this.prisma.serviceException.findFirst({
      where: { tenantId: tid, date },
      select: { id: true },
    });
    if (existing) {
      return this.prisma.serviceException.update({
        where: { id: existing.id },
        data,
      });
    }
    return this.prisma.serviceException.create({
      data: { tenantId: tid, date, ...data },
    });
  }

  async removeException(user: AuthUser, id: string) {
    const tid = this.tid(user);
    const owned = await this.prisma.serviceException.findFirst({
      where: { id, tenantId: tid },
      select: { id: true },
    });
    if (!owned) throw new NotFoundException('Excepción no encontrada.');
    await this.prisma.serviceException.delete({ where: { id } });
    return { ok: true };
  }

  // ───────────────── Motor de slots ─────────────────

  /** Slots para el panel (resuelve el tenant del usuario). */
  async slotsForUser(
    user: AuthUser,
    serviceId: string,
    dateStr: string,
    providerId?: string,
    override?: string,
  ) {
    const tid = this.tid(user, override);
    return this.getAvailableSlots(tid, serviceId, dateStr, providerId || null);
  }

  /** Slots disponibles para un servicio en una fecha (TZ del tenant). Si hay
   *  profesional, usa SU disponibilidad y agenda; si no, la del negocio. */
  async getAvailableSlots(
    tenantId: string,
    serviceId: string,
    dateStr: string,
    providerId?: string | null,
  ) {
    if (!isValidDateStr(dateStr))
      throw new BadRequestException('Fecha inválida (YYYY-MM-DD).');
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { timezone: true },
    });
    const tz = tenant?.timezone || 'America/Bogota';
    const service = await this.prisma.service.findFirst({
      where: { id: serviceId, tenantId, isActive: true },
      select: { durationMin: true },
    });
    if (!service) return { slots: [] as { startAt: string; label: string }[] };

    // Si el negocio tiene profesionales activos, hay que elegir uno: sin
    // providerId no hay slots reservables (evita mostrar/permitir slots de
    // "nivel negocio" que luego el book rechazaría). Alinea slots ↔ reserva.
    if (!providerId && (await this.hasActiveProviders(tenantId))) {
      return { slots: [] };
    }

    const date = new Date(`${dateStr}T00:00:00.000Z`);
    const exc = await this.prisma.serviceException.findFirst({
      where: { tenantId, date },
    });
    let windows: { startMin: number; endMin: number }[];
    if (exc) {
      windows =
        exc.closed || exc.startMin == null || exc.endMin == null
          ? []
          : [{ startMin: exc.startMin, endMin: exc.endMin }];
    } else {
      const weekday = weekdayInTz(dateStr, tz);
      const av = await this.prisma.serviceAvailability.findMany({
        where: { tenantId, weekday, providerId: providerId ?? null },
      });
      windows = av.map((a) => ({ startMin: a.startMin, endMin: a.endMin }));
    }
    if (windows.length === 0) return { slots: [] };

    const dayStart = localMinutesToUtc(dateStr, 0, tz);
    const dayEnd = localMinutesToUtc(dateStr, 24 * 60, tz);
    const appts = await this.prisma.appointment.findMany({
      where: {
        tenantId,
        status: { notIn: ['cancelled', 'no_show'] },
        startAt: { gte: dayStart, lt: dayEnd },
        // Con profesional: solo bloquea SU agenda. Sin profesional: toda la
        // agenda del negocio (un solo recurso).
        ...(providerId ? { providerId } : {}),
      },
      select: { startAt: true, endAt: true },
    });

    const dur = service.durationMin;
    const interval = 15;
    const now = Date.now();
    const slots: { startAt: string; label: string }[] = [];
    for (const w of windows) {
      for (let m = w.startMin; m + dur <= w.endMin; m += interval) {
        const start = localMinutesToUtc(dateStr, m, tz);
        const end = new Date(start.getTime() + dur * 60000);
        if (start.getTime() <= now) continue;
        const overlaps = appts.some(
          (a) => start < a.endAt && end > a.startAt,
        );
        if (overlaps) continue;
        slots.push({ startAt: start.toISOString(), label: minutesToLabel(m) });
      }
    }
    return { slots };
  }

  // ───────────────── Público (reserva del cliente) — Fase 3 ─────────────────

  /** Resuelve el tenant por slug si tiene reservas de servicios habilitadas. */
  private async resolveEnabledTenant(slug: string): Promise<string> {
    const t = await this.prisma.tenant.findUnique({
      where: { slug },
      select: { id: true, status: true, serviceReservationsEnabled: true },
    });
    if (!t || t.status === 'SUSPENDED' || !t.serviceReservationsEnabled) {
      throw new NotFoundException('Reservas de servicios no disponibles.');
    }
    return t.id;
  }

  /** Info pública del negocio + servicios activos (para la página de reserva). */
  async publicInfo(slug: string) {
    const t = await this.prisma.tenant.findUnique({
      where: { slug },
      select: {
        id: true,
        brandName: true,
        status: true,
        serviceReservationsEnabled: true,
        timezone: true,
        logoUrl: true,
        primaryColor: true,
      },
    });
    if (!t || t.status === 'SUSPENDED' || !t.serviceReservationsEnabled) {
      throw new NotFoundException('Reservas de servicios no disponibles.');
    }
    const [services, providers] = await Promise.all([
      this.prisma.service.findMany({
        where: { tenantId: t.id, isActive: true },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
        select: {
          id: true,
          name: true,
          description: true,
          durationMin: true,
          priceCents: true,
        },
      }),
      this.prisma.serviceProvider.findMany({
        where: { tenantId: t.id, isActive: true },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
        select: { id: true, name: true, serviceIds: true },
      }),
    ]);
    return {
      businessName: t.brandName,
      logoUrl: t.logoUrl,
      primaryColor: t.primaryColor,
      timezone: t.timezone,
      services,
      providers, // vacío = negocio sin profesionales (no se elige)
    };
  }

  async publicSlots(
    slug: string,
    serviceId: string,
    dateStr: string,
    providerId?: string,
  ) {
    const tid = await this.resolveEnabledTenant(slug);
    return this.getAvailableSlots(tid, serviceId, dateStr, providerId || null);
  }

  async publicBook(
    slug: string,
    dto: {
      serviceId: string;
      startAt: string;
      customerName: string;
      customerPhone: string;
      providerId?: string | null;
      notes?: string;
    },
  ) {
    const tid = await this.resolveEnabledTenant(slug);
    const appt = await this.createAppointment(tid, {
      ...dto,
      status: 'confirmed',
    });
    return {
      ok: true,
      id: appt.id,
      startAt: appt.startAt,
      endAt: appt.endAt,
      manageToken: appt.manageToken,
    };
  }

  // ───────────────── Gestión por el cliente (token) — Fase 5 ─────────────────

  /** Vista pública de una cita por su token (para reagendar/cancelar). */
  async getByToken(token: string) {
    const a = await this.prisma.appointment.findUnique({
      where: { manageToken: token },
      include: { service: { select: { id: true, name: true, durationMin: true } } },
    });
    if (!a) throw new NotFoundException('Cita no encontrada.');
    const [tenant, provider] = await Promise.all([
      this.prisma.tenant.findUnique({
        where: { id: a.tenantId },
        select: { brandName: true, slug: true, timezone: true, primaryColor: true, logoUrl: true },
      }),
      a.providerId
        ? this.prisma.serviceProvider.findUnique({
            where: { id: a.providerId },
            select: { name: true },
          })
        : Promise.resolve(null),
    ]);
    return {
      status: a.status,
      startAt: a.startAt,
      endAt: a.endAt,
      customerName: a.customerName,
      serviceId: a.serviceId,
      serviceName: a.service?.name ?? null,
      providerId: a.providerId,
      providerName: provider?.name ?? null,
      businessName: tenant?.brandName ?? null,
      slug: tenant?.slug ?? null,
      timezone: tenant?.timezone ?? 'America/Bogota',
      primaryColor: tenant?.primaryColor ?? null,
      logoUrl: tenant?.logoUrl ?? null,
    };
  }

  async cancelByToken(token: string) {
    const a = await this.prisma.appointment.findUnique({
      where: { manageToken: token },
      select: { id: true, status: true, startAt: true },
    });
    if (!a) throw new NotFoundException('Cita no encontrada.');
    if (a.status === 'cancelled')
      return { ok: true, status: 'cancelled' };
    if (a.status === 'completed' || a.status === 'no_show')
      throw new BadRequestException('Esta cita ya no se puede cancelar.');
    await this.prisma.appointment.update({
      where: { id: a.id },
      data: { status: 'cancelled' },
    });
    return { ok: true, status: 'cancelled' };
  }

  /** Reagenda a un nuevo horario (mismo servicio y profesional). */
  async rescheduleByToken(token: string, newStartAtIso: string) {
    const a = await this.prisma.appointment.findUnique({
      where: { manageToken: token },
      include: { service: { select: { durationMin: true } } },
    });
    if (!a) throw new NotFoundException('Cita no encontrada.');
    if (a.status === 'cancelled' || a.status === 'completed' || a.status === 'no_show')
      throw new BadRequestException('Esta cita ya no se puede reagendar.');
    const start = new Date(newStartAtIso);
    if (Number.isNaN(start.getTime()))
      throw new BadRequestException('Fecha/hora inválida.');
    if (start.getTime() <= Date.now())
      throw new BadRequestException('Elige un horario futuro.');
    const end = new Date(start.getTime() + (a.service?.durationMin ?? 30) * 60000);
    // El nuevo horario debe ser un slot real disponible (mismo servicio y
    // profesional). Cierra el hueco de reagendar fuera de hora vía API.
    const tzRow = await this.prisma.tenant.findUnique({
      where: { id: a.tenantId },
      select: { timezone: true },
    });
    const dateStr = dateStrInTz(start, tzRow?.timezone || 'America/Bogota');
    const avail = await this.getAvailableSlots(
      a.tenantId,
      a.serviceId,
      dateStr,
      a.providerId,
    );
    if (!avail.slots.some((s) => s.startAt === start.toISOString())) {
      throw new BadRequestException('Ese horario no está disponible. Elige otro.');
    }
    const clash = await this.prisma.appointment.findFirst({
      where: {
        tenantId: a.tenantId,
        id: { not: a.id },
        status: { notIn: ['cancelled', 'no_show'] },
        startAt: { lt: end },
        endAt: { gt: start },
        ...(a.providerId ? { providerId: a.providerId } : {}),
      },
      select: { id: true },
    });
    if (clash)
      throw new BadRequestException('Ese horario ya está ocupado. Elige otro.');
    const updated = await this.prisma.appointment.update({
      where: { id: a.id },
      data: { startAt: start, endAt: end, status: 'confirmed', reminderSentAt: null },
    });
    // Nueva confirmación con el horario actualizado.
    this.notifyAppointment(updated, 'confirm').catch(() => null);
    return { ok: true, startAt: updated.startAt, endAt: updated.endAt };
  }

  // ───────────────── Citas ─────────────────

  async listAppointments(
    user: AuthUser,
    fromStr: string,
    toStr: string,
    override?: string,
  ) {
    const tid = this.tid(user, override);
    const from = isValidDateStr(fromStr)
      ? new Date(`${fromStr}T00:00:00.000Z`)
      : new Date();
    const to = isValidDateStr(toStr)
      ? new Date(`${toStr}T23:59:59.999Z`)
      : new Date(from.getTime() + 7 * 24 * 3600 * 1000);
    return this.prisma.appointment.findMany({
      where: { tenantId: tid, startAt: { gte: from, lte: to } },
      orderBy: { startAt: 'asc' },
      include: { service: { select: { name: true, durationMin: true } } },
    });
  }

  /** Crea una cita (desde el panel o pública). Valida solapamiento. */
  async createAppointment(
    tenantId: string,
    dto: {
      serviceId: string;
      startAt: string; // ISO UTC
      customerName: string;
      customerPhone: string;
      customerId?: string | null;
      providerId?: string | null;
      notes?: string;
      status?: ApptStatus;
    },
  ) {
    const service = await this.prisma.service.findFirst({
      where: { id: dto.serviceId, tenantId, isActive: true },
      select: { id: true, durationMin: true },
    });
    if (!service) throw new BadRequestException('Servicio no válido.');

    // Profesional (Fase 5): si el negocio tiene profesionales activos, es
    // obligatorio elegir uno válido; si no, la cita es a nivel negocio.
    let providerId: string | null = dto.providerId || null;
    const hasProviders = await this.hasActiveProviders(tenantId);
    if (hasProviders) {
      if (!providerId)
        throw new BadRequestException('Elige un profesional.');
      const p = await this.prisma.serviceProvider.findFirst({
        where: { id: providerId, tenantId, isActive: true },
        select: { id: true, serviceIds: true },
      });
      if (!p) throw new BadRequestException('Profesional no válido.');
      // serviceIds vacío = hace todos; si no, debe incluir el servicio.
      if (p.serviceIds.length > 0 && !p.serviceIds.includes(dto.serviceId))
        throw new BadRequestException(
          'Ese profesional no realiza este servicio.',
        );
    } else {
      providerId = null;
    }

    const start = new Date(dto.startAt);
    if (Number.isNaN(start.getTime()))
      throw new BadRequestException('Fecha/hora inválida.');
    const end = new Date(start.getTime() + service.durationMin * 60000);
    const name = (dto.customerName ?? '').trim();
    const phone = (dto.customerPhone ?? '').trim();
    if (!name || phone.length < 6)
      throw new BadRequestException('Nombre y teléfono del cliente requeridos.');

    // El horario DEBE ser un slot real disponible (dentro del horario, futuro,
    // no ocupado). Cierra el hueco de reservar fuera de hora / en el pasado vía
    // API directa. Reusa el motor de slots (respeta franjas, excepciones, TZ).
    const tzRow = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { timezone: true },
    });
    const dateStr = dateStrInTz(start, tzRow?.timezone || 'America/Bogota');
    const avail = await this.getAvailableSlots(
      tenantId,
      dto.serviceId,
      dateStr,
      providerId,
    );
    if (!avail.slots.some((s) => s.startAt === start.toISOString())) {
      throw new BadRequestException('Ese horario no está disponible. Elige otro.');
    }

    // Anti-doble-reserva (guard de carrera; los slots ya excluyen ocupados).
    const clash = await this.prisma.appointment.findFirst({
      where: {
        tenantId,
        status: { notIn: ['cancelled', 'no_show'] },
        startAt: { lt: end },
        endAt: { gt: start },
        ...(providerId ? { providerId } : {}),
      },
      select: { id: true },
    });
    if (clash)
      throw new BadRequestException('Ese horario ya está ocupado. Elige otro.');

    // Extra: el cliente que agenda queda en la lista de Clientes del negocio
    // (match por teléfono). NO se emite pase ni se suma sello (respeta PDF734).
    const customerId =
      dto.customerId ?? (await this.matchOrCreateCustomer(tenantId, name, phone));

    const appt = await this.prisma.appointment.create({
      data: {
        tenantId,
        serviceId: dto.serviceId,
        providerId,
        customerId,
        customerName: name,
        customerPhone: phone,
        startAt: start,
        endAt: end,
        status: dto.status ?? 'confirmed',
        notes: dto.notes?.trim() || null,
        manageToken: randomBytes(16).toString('hex'),
      },
    });
    // Fase 4: SMS de confirmación al cliente (best-effort, aislado por marca).
    this.notifyAppointment(appt, 'confirm').catch(() => null);
    return appt;
  }

  /** Alta de cita desde el panel (scopeada al negocio del usuario). */
  async createAppointmentFromPanel(
    user: AuthUser,
    dto: {
      serviceId: string;
      startAt: string;
      customerName: string;
      customerPhone: string;
      providerId?: string | null;
      notes?: string;
    },
    override?: string,
  ) {
    const tid = this.tid(user, override);
    return this.createAppointment(tid, dto);
  }

  async setAppointmentStatus(user: AuthUser, id: string, status: ApptStatus) {
    if (!APPT_STATUSES.includes(status))
      throw new BadRequestException('Estado inválido.');
    const tid = this.tid(user);
    const owned = await this.prisma.appointment.findFirst({
      where: { id, tenantId: tid },
      select: { id: true },
    });
    if (!owned) throw new NotFoundException('Cita no encontrada.');
    return this.prisma.appointment.update({ where: { id }, data: { status } });
  }

  // ───────────────── Notificaciones (Fase 4) ─────────────────

  /** Creds SMS del negocio: propias > subcuenta de su marca blanca > NADA.
   *  Nunca la de Clubify (mismo aislamiento que las automatizaciones). */
  private credsForTenant(tenant: {
    growBusinessLocationId?: string | null;
    growBusinessApiKey?: string | null;
    growBusinessSwitchNumber?: number | null;
    whiteLabel?: {
      growBusinessLocationId?: string | null;
      growBusinessApiKey?: string | null;
      growBusinessSwitchNumber?: number | null;
    } | null;
  }): { locationId: string; apiKey: string; switchNumber: number | null } | null {
    if (tenant?.growBusinessLocationId && tenant?.growBusinessApiKey) {
      return {
        locationId: tenant.growBusinessLocationId,
        apiKey: tenant.growBusinessApiKey,
        switchNumber: tenant.growBusinessSwitchNumber ?? null,
      };
    }
    return brandGrowCreds(tenant?.whiteLabel);
  }

  private fmtWhen(d: Date, tz: string) {
    const fecha = new Intl.DateTimeFormat('es-CO', {
      timeZone: tz,
      weekday: 'long',
      day: 'numeric',
      month: 'long',
    }).format(d);
    const hora = new Intl.DateTimeFormat('es-CO', {
      timeZone: tz,
      hour: '2-digit',
      minute: '2-digit',
    }).format(d);
    return { fecha, hora };
  }

  /** SMS de confirmación / recordatorio de una cita al cliente (best-effort). */
  private async notifyAppointment(
    appt: {
      tenantId: string;
      serviceId: string;
      startAt: Date;
      customerName: string;
      customerPhone: string;
      manageToken?: string | null;
    },
    kind: 'confirm' | 'reminder',
  ) {
    try {
      const [tenant, service] = await Promise.all([
        this.prisma.tenant.findUnique({
          where: { id: appt.tenantId },
          select: {
            brandName: true,
            timezone: true,
            growBusinessLocationId: true,
            growBusinessApiKey: true,
            growBusinessSwitchNumber: true,
            whiteLabel: {
              select: { ...BRAND_GROW_SELECT, ...BRAND_DOMAIN_SELECT },
            },
          },
        }),
        this.prisma.service.findUnique({
          where: { id: appt.serviceId },
          select: { name: true },
        }),
      ]);
      if (!tenant) return;
      const creds = this.credsForTenant(tenant);
      if (!creds) return; // sin creds propias ni de marca → no se envía
      const tz = tenant.timezone || 'America/Bogota';
      const { fecha, hora } = this.fmtWhen(appt.startAt, tz);
      const svc = service?.name ?? 'tu servicio';
      const firstName = (appt.customerName || '').trim().split(/\s+/)[0] || '';
      // Va al CLIENTE FINAL: el enlace debe ser del dominio de SU marca. Con
      // el APP_URL global, quien reservaba en un negocio Sellea reagendaba en
      // soyclubify.com, con la vista previa de Clubify en WhatsApp.
      const appUrl = brandAppUrl(
        tenant.whiteLabel,
        process.env.APP_URL ?? 'https://soyclubify.com',
      );
      const manageLine = appt.manageToken
        ? ` Gestiona/reagenda: ${appUrl}/cita/gestion/${appt.manageToken}`
        : '';
      const body =
        kind === 'confirm'
          ? `${tenant.brandName}: ${firstName ? firstName + ', tu' : 'Tu'} cita de ${svc} quedó confirmada para el ${fecha} a las ${hora}. ¡Te esperamos!${manageLine}`
          : `${tenant.brandName}: Recordatorio — tu cita de ${svc} es el ${fecha} a las ${hora}.${manageLine}`;
      await this.growBusiness
        .sendSmsWithCreds(creds, appt.customerPhone, body)
        .catch(() => null);
    } catch (e) {
      this.logger.warn(
        `notifyAppointment(${kind}) falló: ${(e as Error).message}`,
      );
    }
  }

  /** Cron: recordatorio de citas que empiezan dentro de las próximas ~3h.
   *  Idempotente por Appointment.reminderSentAt. */
  @Cron('*/30 * * * *')
  async remindUpcomingAppointments() {
    const now = new Date();
    const horizon = new Date(now.getTime() + 3 * 60 * 60 * 1000);
    const due = await this.prisma.appointment.findMany({
      where: {
        status: 'confirmed',
        reminderSentAt: null,
        startAt: { gt: now, lte: horizon },
      },
      take: 200,
      orderBy: { startAt: 'asc' },
    });
    for (const a of due) {
      await this.notifyAppointment(a, 'reminder');
      await this.prisma.appointment
        .update({ where: { id: a.id }, data: { reminderSentAt: new Date() } })
        .catch(() => null);
    }
  }
}
