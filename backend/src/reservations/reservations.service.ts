import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ReservationStatus, ReservationChannel } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { AuthUser } from '../common/decorators/current-user.decorator';
import { GrowBusinessService } from '../integrations/grow-business.service';

export type ZoneDto = {
  name: string;
  slug?: string;
  type?: string;
  position?: number;
  isActive?: boolean;
};

export type TableDto = {
  zoneId?: string | null;
  number: string;
  seats: number;
  shape?: string;
  posX?: number;
  posY?: number;
  width?: number | null;
  height?: number | null;
  isBlocked?: boolean;
  isActive?: boolean;
};

export type ReservationDto = {
  customerName: string;
  customerPhone: string;
  customerEmail?: string;
  party: number;
  date: string; // ISO YYYY-MM-DD
  time: string; // HH:MM
  notes?: string;
  zoneId?: string | null;
  tableId?: string | null;
  channel?: ReservationChannel;
  status?: ReservationStatus;
};

/**
 * Reservations module 2026-06-12. Mesas + zonas + reservas con flujo
 * público "el negocio recibe la solicitud y confirma manualmente". El
 * WhatsApp al tenant se manda al crear la reserva pública o desde admin.
 */
@Injectable()
export class ReservationsService {
  private logger = new Logger(ReservationsService.name);
  constructor(
    private prisma: PrismaService,
    private growBusiness: GrowBusinessService,
  ) {}

  private tid(user: AuthUser, override?: string) {
    if (user.role === 'SUPER_ADMIN') {
      if (!override) throw new ForbiddenException('tenantId required');
      return override;
    }
    if (!user.tenantId) throw new ForbiddenException();
    return user.tenantId;
  }

  // ============================================================
  //                              ZONES
  // ============================================================

  listZones(user: AuthUser, override?: string) {
    const tid = this.tid(user, override);
    return this.prisma.reservationZone.findMany({
      where: { tenantId: tid, isActive: true },
      orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
      include: { tables: { where: { isActive: true }, orderBy: { number: 'asc' } } },
    });
  }

  async createZone(user: AuthUser, dto: ZoneDto, override?: string) {
    const tid = this.tid(user, override);
    const slug = (dto.slug || dto.name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    if (!slug) throw new BadRequestException('Slug invalido');
    return this.prisma.reservationZone.create({
      data: {
        tenantId: tid,
        name: dto.name.trim(),
        slug,
        type: dto.type ?? 'INDOOR',
        position: dto.position ?? 0,
        isActive: dto.isActive ?? true,
      },
    });
  }

  async updateZone(user: AuthUser, id: string, patch: Partial<ZoneDto>) {
    await this.requireOwnedZone(user, id);
    return this.prisma.reservationZone.update({
      where: { id },
      data: {
        name: patch.name?.trim(),
        type: patch.type,
        position: patch.position,
        isActive: patch.isActive,
      },
    });
  }

  async removeZone(user: AuthUser, id: string) {
    await this.requireOwnedZone(user, id);
    await this.prisma.reservationZone.update({ where: { id }, data: { isActive: false } });
    return { ok: true };
  }

  private async requireOwnedZone(user: AuthUser, id: string) {
    const z = await this.prisma.reservationZone.findUnique({ where: { id } });
    if (!z) throw new NotFoundException();
    if (user.role !== 'SUPER_ADMIN' && z.tenantId !== user.tenantId) throw new ForbiddenException();
    return z;
  }

  // ============================================================
  //                              TABLES
  // ============================================================

  listTables(user: AuthUser, override?: string) {
    const tid = this.tid(user, override);
    return this.prisma.reservationTable.findMany({
      where: { tenantId: tid, isActive: true },
      orderBy: { createdAt: 'asc' },
      include: { zone: true },
    });
  }

  async createTable(user: AuthUser, dto: TableDto, override?: string) {
    const tid = this.tid(user, override);
    return this.prisma.reservationTable.create({
      data: {
        tenantId: tid,
        zoneId: dto.zoneId ?? null,
        number: String(dto.number).trim(),
        seats: dto.seats,
        shape: dto.shape ?? 'ROUND',
        posX: dto.posX ?? 0,
        posY: dto.posY ?? 0,
        width: dto.width ?? null,
        height: dto.height ?? null,
        isBlocked: dto.isBlocked ?? false,
        isActive: dto.isActive ?? true,
      },
    });
  }

  async updateTable(user: AuthUser, id: string, patch: Partial<TableDto>) {
    await this.requireOwnedTable(user, id);
    return this.prisma.reservationTable.update({
      where: { id },
      data: {
        zoneId: patch.zoneId === null ? null : patch.zoneId,
        number: patch.number?.trim(),
        seats: patch.seats,
        shape: patch.shape,
        posX: patch.posX,
        posY: patch.posY,
        width: patch.width === null ? null : patch.width,
        height: patch.height === null ? null : patch.height,
        isBlocked: patch.isBlocked,
        isActive: patch.isActive,
      },
    });
  }

  async removeTable(user: AuthUser, id: string) {
    await this.requireOwnedTable(user, id);
    await this.prisma.reservationTable.update({ where: { id }, data: { isActive: false } });
    return { ok: true };
  }

  private async requireOwnedTable(user: AuthUser, id: string) {
    const t = await this.prisma.reservationTable.findUnique({ where: { id } });
    if (!t) throw new NotFoundException();
    if (user.role !== 'SUPER_ADMIN' && t.tenantId !== user.tenantId) throw new ForbiddenException();
    return t;
  }

  // ============================================================
  //                          RESERVATIONS
  // ============================================================

  list(user: AuthUser, filters: { date?: string; status?: ReservationStatus } = {}, override?: string) {
    const tid = this.tid(user, override);
    const where: any = { tenantId: tid };
    if (filters.date) {
      const [y, m, d] = filters.date.split('-').map(Number);
      const start = new Date(Date.UTC(y, m - 1, d, 0, 0, 0));
      const end = new Date(Date.UTC(y, m - 1, d, 23, 59, 59));
      where.date = { gte: start, lte: end };
    }
    if (filters.status) where.status = filters.status;
    return this.prisma.reservation.findMany({
      where,
      orderBy: [{ date: 'asc' }, { time: 'asc' }],
      include: { table: true, zone: true, customer: { select: { id: true, fullName: true, tags: true } } },
    });
  }

  async create(user: AuthUser, dto: ReservationDto, override?: string, opts?: { force?: boolean }) {
    const tid = this.tid(user, override);
    return this.createForTenant(tid, dto, dto.channel ?? 'PHONE', {
      notify: true,
      skipCapacityCheck: opts?.force === true,
    });
  }

  /** Crea reserva para un tenant — usado por admin y por endpoint público.
   *  Encadena: validación de slot, findOrCreate Customer por phone, crea
   *  reservation, notifica. */
  async createForTenant(
    tenantId: string,
    dto: ReservationDto,
    channel: ReservationChannel,
    opts: { notify: boolean; skipCapacityCheck?: boolean },
  ) {
    this.assertValidDto(dto);

    // Validación de capacidad / slot. Skip si admin lo desactiva
    // explícitamente (e.g. fuerza una reserva fuera de horario).
    if (!opts.skipCapacityCheck) {
      await this.assertSlotAvailable(tenantId, dto.date, dto.time, dto.zoneId ?? null, dto.party);
    }

    // FindOrCreate Customer por phone (CRM enrichment)
    const phone = dto.customerPhone.trim();
    const customer = await this.findOrCreateCustomer(tenantId, phone, dto.customerName.trim(), dto.customerEmail);

    const [y, m, d] = dto.date.split('-').map(Number);
    // Mediodía UTC para evitar problemas de zona horaria al filtrar por día.
    const dateAtNoonUtc = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));

    const reservation = await this.prisma.reservation.create({
      data: {
        tenantId,
        customerId: customer?.id ?? null,
        customerName: dto.customerName.trim(),
        customerPhone: phone,
        customerEmail: dto.customerEmail?.trim() || null,
        party: dto.party,
        date: dateAtNoonUtc,
        time: dto.time,
        notes: dto.notes?.trim() || null,
        zoneId: dto.zoneId ?? null,
        tableId: dto.tableId ?? null,
        channel,
        status: dto.status ?? 'PENDING',
      },
      include: { table: true, zone: true },
    });

    if (opts.notify) {
      this.notifyTenant(reservation).catch((e) =>
        this.logger.warn(`notifyTenant falló (reservationId=${reservation.id}): ${(e as Error).message}`),
      );
    }
    return reservation;
  }

  async update(user: AuthUser, id: string, patch: Partial<ReservationDto> & { status?: ReservationStatus }) {
    const r = await this.requireOwnedReservation(user, id);
    const now = new Date();
    const data: any = {
      customerName: patch.customerName?.trim(),
      customerPhone: patch.customerPhone?.trim(),
      customerEmail: patch.customerEmail?.trim(),
      party: patch.party,
      time: patch.time,
      notes: patch.notes?.trim(),
      zoneId: patch.zoneId === null ? null : patch.zoneId,
      tableId: patch.tableId === null ? null : patch.tableId,
    };
    if (patch.status && patch.status !== r.status) {
      data.status = patch.status;
      if (patch.status === 'CONFIRMED' && !r.confirmedAt) data.confirmedAt = now;
      if (patch.status === 'SEATED' && !r.seatedAt) data.seatedAt = now;
      if (patch.status === 'COMPLETED' && !r.completedAt) data.completedAt = now;
      if (patch.status === 'CANCELLED' && !r.cancelledAt) data.cancelledAt = now;
    }
    return this.prisma.reservation.update({ where: { id }, data, include: { table: true, zone: true } });
  }

  async remove(user: AuthUser, id: string) {
    await this.requireOwnedReservation(user, id);
    await this.prisma.reservation.delete({ where: { id } });
    return { ok: true };
  }

  private async requireOwnedReservation(user: AuthUser, id: string) {
    const r = await this.prisma.reservation.findUnique({ where: { id } });
    if (!r) throw new NotFoundException();
    if (user.role !== 'SUPER_ADMIN' && r.tenantId !== user.tenantId) throw new ForbiddenException();
    return r;
  }

  // ============================================================
  //                           HELPERS
  // ============================================================

  private assertValidDto(dto: ReservationDto) {
    if (!dto.customerName?.trim()) throw new BadRequestException('Nombre requerido');
    if (!dto.customerPhone?.trim()) throw new BadRequestException('Teléfono requerido');
    if (!dto.party || dto.party < 1) throw new BadRequestException('party >= 1');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dto.date)) throw new BadRequestException('date YYYY-MM-DD');
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(dto.time)) throw new BadRequestException('time HH:MM 24h');
  }

  /** Busca un Customer por (tenant, phone); si no existe lo crea con el
   *  fullName/email dados. Sin tags ni notas — eso lo agrega el admin
   *  después si quiere segmentar. */
  private async findOrCreateCustomer(
    tenantId: string,
    phone: string,
    fullName: string,
    email?: string,
  ) {
    const existing = await this.prisma.customer.findUnique({
      where: { tenantId_phone: { tenantId, phone } },
    });
    if (existing) return existing;
    try {
      return await this.prisma.customer.create({
        data: {
          tenantId,
          phone,
          fullName,
          email: email?.trim() || null,
        },
      });
    } catch (e: any) {
      // Race con otro create por mismo phone → re-buscar.
      if (e?.code === 'P2002') {
        return this.prisma.customer.findUnique({
          where: { tenantId_phone: { tenantId, phone } },
        });
      }
      throw e;
    }
  }

  // ============================================================
  //                      SLOT CAPACITY / AVAILABILITY
  // ============================================================

  /** Ventana en minutos durante la cual una reserva "ocupa" la zona/mesa.
   *  Una reserva a las 13:00 bloquea capacidad entre [11:30, 14:30) — es
   *  decir, otras reservas dentro de esa ventana cuentan al sumar
   *  occupancy. 90 min es el turnover típico de restaurante. */
  private static readonly SLOT_WINDOW_MIN = 90;

  /** Default slots públicos. Idénticos a los del controller para que
   *  availability pueda chequear todos los slots de un día sin hardcode
   *  duplicado. */
  private static readonly DEFAULT_SLOTS = [
    '13:00', '13:30', '14:00', '14:30', '21:00', '21:30', '22:00',
  ];

  /** Suma de seats de mesas activas y no bloqueadas. Si zoneId es null,
   *  cuenta todas las mesas del tenant. Si la zona no tiene mesas (o el
   *  tenant no tiene mesas configuradas), retorna 0. */
  private async getCapacity(tenantId: string, zoneId: string | null): Promise<number> {
    const tables = await this.prisma.reservationTable.findMany({
      where: {
        tenantId,
        isActive: true,
        isBlocked: false,
        ...(zoneId ? { zoneId } : {}),
      },
      select: { seats: true },
    });
    return tables.reduce((acc, t) => acc + (t.seats || 0), 0);
  }

  /** Suma de party de reservas que solapan con (date, time) por menos de
   *  SLOT_WINDOW_MIN. Solo cuenta status activos (no CANCELLED/COMPLETED/
   *  NO_SHOW). Si zoneId está provisto, solo cuenta reservas en esa zona o
   *  sin zona asignada (porque ocupan capacidad global). Si zoneId es
   *  null, cuenta todas las reservas activas del día. */
  private async getOccupancy(
    tenantId: string,
    date: string,
    time: string,
    zoneId: string | null,
    excludeReservationId?: string,
  ): Promise<number> {
    const [y, m, d] = date.split('-').map(Number);
    const start = new Date(Date.UTC(y, m - 1, d, 0, 0, 0));
    const end = new Date(Date.UTC(y, m - 1, d, 23, 59, 59));
    const reservations = await this.prisma.reservation.findMany({
      where: {
        tenantId,
        date: { gte: start, lte: end },
        status: { in: ['PENDING', 'CONFIRMED', 'SEATED'] },
        ...(excludeReservationId ? { id: { not: excludeReservationId } } : {}),
      },
      select: { id: true, time: true, party: true, zoneId: true },
    });
    const slotMin = ReservationsService.toMinutes(time);
    return reservations
      .filter((r) => {
        // Filtrar por zona: si pedimos availability con zoneId, solo
        // suman las reservas en esa zona. Si pedimos global (zoneId null),
        // suman todas.
        if (zoneId && r.zoneId && r.zoneId !== zoneId) return false;
        // Filtrar por ventana de tiempo.
        const diff = Math.abs(ReservationsService.toMinutes(r.time) - slotMin);
        return diff < ReservationsService.SLOT_WINDOW_MIN;
      })
      .reduce((acc, r) => acc + r.party, 0);
  }

  private static toMinutes(time: string): number {
    const [h, m] = time.split(':').map(Number);
    return h * 60 + m;
  }

  /** Lanza ConflictException 409 si no hay capacidad para `party` en
   *  (date, time, zoneId). Si el tenant no tiene mesas configuradas la
   *  validación se salta (bootstrap mode — sigue permitiendo reservas). */
  async assertSlotAvailable(
    tenantId: string,
    date: string,
    time: string,
    zoneId: string | null,
    party: number,
  ): Promise<void> {
    const capacity = await this.getCapacity(tenantId, zoneId);
    if (capacity === 0) {
      // Si pidieron zona específica y la zona no tiene mesas → conflict.
      // Si pidieron global y el tenant no tiene NINGUNA mesa → bootstrap,
      // dejamos pasar (caso de tenant recién activado).
      if (zoneId) {
        throw new ConflictException('Esta zona no tiene mesas disponibles');
      }
      this.logger.warn(
        `Tenant ${tenantId} sin mesas configuradas — saltando validación de slot`,
      );
      return;
    }
    const occupied = await this.getOccupancy(tenantId, date, time, zoneId);
    const remaining = capacity - occupied;
    if (remaining < party) {
      throw new ConflictException(
        remaining > 0
          ? `Solo quedan ${remaining} lugares en este horario. Probá otra hora.`
          : 'Este horario está completo. Probá otra hora.',
      );
    }
  }

  /** Devuelve disponibilidad por slot para una fecha + party. Para cada
   *  slot del DEFAULT_SLOTS calcula capacity - occupancy y marca como
   *  available si remaining >= party. Si no hay mesas configuradas se
   *  marca todo como available (bootstrap mode). */
  async getAvailability(
    tenantId: string,
    date: string,
    party: number,
    zoneId: string | null = null,
  ): Promise<{ time: string; available: boolean; remaining: number }[]> {
    const capacity = await this.getCapacity(tenantId, zoneId);
    if (capacity === 0) {
      // Bootstrap: sin mesas, todo available (la validación misma se salta).
      return ReservationsService.DEFAULT_SLOTS.map((time) => ({
        time,
        available: true,
        remaining: 99,
      }));
    }
    const results = await Promise.all(
      ReservationsService.DEFAULT_SLOTS.map(async (time) => {
        const occupied = await this.getOccupancy(tenantId, date, time, zoneId);
        const remaining = Math.max(0, capacity - occupied);
        return { time, available: remaining >= party, remaining };
      }),
    );
    return results;
  }

  /** Manda WhatsApp/SMS al tenant owner avisando de la reserva nueva.
   *  Mensaje plain text con todos los datos para que el equipo confirme. */
  private async notifyTenant(reservation: {
    id: string;
    tenantId: string;
    customerName: string;
    customerPhone: string;
    party: number;
    date: Date;
    time: string;
    notes: string | null;
    zone?: { name: string } | null;
    channel: ReservationChannel;
  }) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: reservation.tenantId },
      select: { brandName: true, whatsappPhone: true, phone: true },
    });
    const dest = tenant?.whatsappPhone || tenant?.phone;
    if (!dest) {
      this.logger.warn(
        `Tenant ${reservation.tenantId} sin whatsappPhone/phone — no se envió notificación`,
      );
      return;
    }
    const dateStr = reservation.date.toISOString().slice(0, 10);
    const zoneStr = reservation.zone?.name ? ` · ${reservation.zone.name}` : '';
    const notesStr = reservation.notes ? `\nNotas: ${reservation.notes}` : '';
    const body =
      `🔔 NUEVA RESERVA · ${tenant?.brandName ?? ''}\n` +
      `${reservation.customerName} · ${reservation.party} pax\n` +
      `📅 ${dateStr} a las ${reservation.time}${zoneStr}\n` +
      `📞 ${reservation.customerPhone}` +
      notesStr +
      `\n\nConfirmá manualmente con el cliente.`;
    try {
      await this.growBusiness.sendSms(reservation.tenantId, dest, body);
      await this.prisma.reservation.update({
        where: { id: reservation.id },
        data: { notifiedAt: new Date() },
      });
    } catch (e) {
      this.logger.warn(`SMS notif falló: ${(e as Error).message}`);
    }
  }
}
