import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ReservationStatus, ReservationChannel } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { AuthUser } from '../common/decorators/current-user.decorator';
import { GrowBusinessService } from '../integrations/grow-business.service';
import { WalletService } from '../wallet/wallet.service';
import { PassesService } from '../passes/passes.service';
import { AppConfigService } from '../common/config/app-config.service';
import { sign, verify } from 'jsonwebtoken';

const QR_RESERVATION_PROTOCOL = 'clubify-reservation:';

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
    private wallet: WalletService,
    private passes: PassesService,
    private appConfig: AppConfigService,
  ) {}

  /** Token HMAC-firmado para cancelar (SMS). Reusa QR_HMAC_SECRET. */
  signCancelToken(reservationId: string): string {
    return sign(
      { rid: reservationId, t: 'cancel' },
      this.appConfig.QR_HMAC_SECRET,
      { algorithm: 'HS256', expiresIn: '30d' },
    );
  }
  verifyCancelToken(token: string): string | null {
    try {
      const payload = verify(token, this.appConfig.QR_HMAC_SECRET) as any;
      if (payload?.t !== 'cancel' || !payload?.rid) return null;
      return payload.rid as string;
    } catch {
      return null;
    }
  }

  /** Token HMAC-firmado para el pase digital de confirmación. Diferente
   *  del cancel para que un link no permita la otra acción. */
  signPassToken(reservationId: string): string {
    return sign(
      { rid: reservationId, t: 'pass' },
      this.appConfig.QR_HMAC_SECRET,
      { algorithm: 'HS256', expiresIn: '60d' },
    );
  }
  verifyPassToken(token: string): string | null {
    try {
      const payload = verify(token, this.appConfig.QR_HMAC_SECRET) as any;
      if (payload?.t !== 'pass' || !payload?.rid) return null;
      return payload.rid as string;
    } catch {
      return null;
    }
  }

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
    let grantStamp = false;
    let notifyConfirmed = false;
    let notifyCancelled = false;
    if (patch.status && patch.status !== r.status) {
      data.status = patch.status;
      if (patch.status === 'CONFIRMED' && !r.confirmedAt) {
        data.confirmedAt = now;
        notifyConfirmed = true;
      }
      if (patch.status === 'SEATED' && !r.seatedAt) {
        data.seatedAt = now;
        if (!r.stampGrantedAt) grantStamp = true;
      }
      if (patch.status === 'COMPLETED' && !r.completedAt) data.completedAt = now;
      if (patch.status === 'CANCELLED' && !r.cancelledAt) {
        data.cancelledAt = now;
        notifyCancelled = true;
      }
    }
    const updated = await this.prisma.reservation.update({
      where: { id },
      data,
      include: { table: true, zone: true },
    });

    if (grantStamp) {
      this.grantReservationStamp(updated.id).catch((e) =>
        this.logger.warn(
          `grantReservationStamp falló (reservationId=${updated.id}): ${(e as Error).message}`,
        ),
      );
    }
    if (notifyConfirmed) {
      this.notifyCustomerConfirmed(updated.id).catch((e) =>
        this.logger.warn(
          `notifyCustomerConfirmed falló (reservationId=${updated.id}): ${(e as Error).message}`,
        ),
      );
    }
    if (notifyCancelled) {
      this.notifyCustomerCancelled(updated.id).catch((e) =>
        this.logger.warn(
          `notifyCustomerCancelled falló (reservationId=${updated.id}): ${(e as Error).message}`,
        ),
      );
    }
    return updated;
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

  /** Busca un Customer por (tenant, phone). Si existe, le agrega el tag
   *  "reserva" si no lo tenía ya (auto-segmentación). Si no existe lo
   *  crea con el tag desde el inicio. */
  private async findOrCreateCustomer(
    tenantId: string,
    phone: string,
    fullName: string,
    email?: string,
  ) {
    const existing = await this.prisma.customer.findUnique({
      where: { tenantId_phone: { tenantId, phone } },
    });
    if (existing) {
      if (!existing.tags?.includes('reserva')) {
        await this.prisma.customer.update({
          where: { id: existing.id },
          data: { tags: { push: 'reserva' } },
        });
      }
      return existing;
    }
    try {
      return await this.prisma.customer.create({
        data: {
          tenantId,
          phone,
          fullName,
          email: email?.trim() || null,
          tags: ['reserva'],
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

  // ============================================================
  //                          STATS / METRICS
  // ============================================================

  /** Métricas agregadas por rango de fechas para el dashboard de
   *  `/app/reservations`. Devuelve totales, tasas y breakdowns por
   *  hora, zona, canal y día de la semana. */
  async stats(user: AuthUser, params: { from?: string; to?: string; tenantId?: string } = {}) {
    const tid = this.tid(user, params.tenantId);
    const now = new Date();
    const defaultFrom = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 29, 0, 0, 0));
    const defaultTo = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 7, 23, 59, 59));
    const from = params.from ? this.parseDate(params.from) : defaultFrom;
    const to = params.to ? this.parseDate(params.to, true) : defaultTo;

    const reservations = await this.prisma.reservation.findMany({
      where: {
        tenantId: tid,
        date: { gte: from, lte: to },
      },
      select: {
        id: true,
        party: true,
        time: true,
        date: true,
        status: true,
        channel: true,
        zoneId: true,
        zone: { select: { name: true } },
      },
    });

    const total = reservations.length;
    const totalPax = reservations.reduce((s, r) => s + r.party, 0);
    const cancelled = reservations.filter((r) => r.status === 'CANCELLED').length;
    const noShow = reservations.filter((r) => r.status === 'NO_SHOW').length;
    const completed = reservations.filter((r) => ['SEATED', 'COMPLETED'].includes(r.status)).length;
    const confirmed = reservations.filter((r) => r.status === 'CONFIRMED').length;
    const pending = reservations.filter((r) => r.status === 'PENDING').length;

    // Tasa = % sobre lo que NO está PENDING (las pendientes no cuentan
    // como caso resuelto todavía).
    const resolved = total - pending;
    const noShowRate = resolved > 0 ? Math.round((noShow / resolved) * 100) : 0;
    const cancelRate = resolved > 0 ? Math.round((cancelled / resolved) * 100) : 0;
    const completionRate = resolved > 0 ? Math.round((completed / resolved) * 100) : 0;
    const avgParty = total > 0 ? Math.round((totalPax / total) * 10) / 10 : 0;

    // Breakdown por hora (HH:00)
    const byHour: Record<string, number> = {};
    reservations.forEach((r) => {
      const hour = r.time.slice(0, 2) + ':00';
      byHour[hour] = (byHour[hour] || 0) + r.party;
    });
    const topHours = Object.entries(byHour)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([hour, pax]) => ({ hour, pax }));

    // Breakdown por zona
    const byZone: Record<string, { name: string; count: number; pax: number }> = {};
    reservations.forEach((r) => {
      const key = r.zone?.name ?? 'Sin zona';
      if (!byZone[key]) byZone[key] = { name: key, count: 0, pax: 0 };
      byZone[key].count++;
      byZone[key].pax += r.party;
    });
    const zoneBreakdown = Object.values(byZone).sort((a, b) => b.pax - a.pax);

    // Breakdown por canal
    const byChannel: Record<string, number> = {};
    reservations.forEach((r) => {
      byChannel[r.channel] = (byChannel[r.channel] || 0) + 1;
    });

    // Breakdown por día de la semana (0=Dom, 6=Sáb)
    const byDow: Record<number, number> = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
    reservations.forEach((r) => {
      const dow = r.date.getUTCDay();
      byDow[dow] += r.party;
    });

    return {
      range: {
        from: from.toISOString().slice(0, 10),
        to: to.toISOString().slice(0, 10),
        days: Math.ceil((to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24)),
      },
      totals: {
        reservations: total,
        pax: totalPax,
        avgParty,
        pending,
        confirmed,
        completed,
        cancelled,
        noShow,
      },
      rates: {
        completionRate,
        noShowRate,
        cancelRate,
      },
      topHours,
      zoneBreakdown,
      byChannel,
      byDow,
    };
  }

  private parseDate(s: string, isEnd = false): Date {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new BadRequestException('Fecha YYYY-MM-DD');
    const [y, m, d] = s.split('-').map(Number);
    return isEnd
      ? new Date(Date.UTC(y, m - 1, d, 23, 59, 59))
      : new Date(Date.UTC(y, m - 1, d, 0, 0, 0));
  }

  // ============================================================
  //               NOTIFICACIONES AL CLIENTE
  // ============================================================

  /** Notifica al cliente cuando el negocio confirma su reserva.
   *  Mensaje incluye fecha, hora, party, nombre del negocio + link de
   *  cancelación firmado. Fire-and-forget. */
  private async notifyCustomerConfirmed(reservationId: string) {
    const r = await this.prisma.reservation.findUnique({
      where: { id: reservationId },
      select: {
        tenantId: true,
        customerName: true,
        customerPhone: true,
        party: true,
        date: true,
        time: true,
        zone: { select: { name: true } },
        tenant: { select: { brandName: true } },
      },
    });
    if (!r) return;
    const dateStr = r.date.toISOString().slice(0, 10);
    const partyStr = `${r.party} ${r.party === 1 ? 'persona' : 'personas'}`;
    const zoneStr = r.zone?.name ? ` (${r.zone.name})` : '';
    const cancelToken = this.signCancelToken(reservationId);
    const passToken = this.signPassToken(reservationId);
    const cancelUrl = `https://soyclubify.com/r/cancelar/${cancelToken}`;
    const passUrl = `https://soyclubify.com/r/pase/${passToken}`;
    const body =
      `✅ ¡Tu reserva está confirmada!\n` +
      `${r.tenant.brandName} te espera el ${dateStr} a las ${r.time} para ${partyStr}${zoneStr}.\n\n` +
      `📱 Tu pase digital: ${passUrl}\n` +
      `❌ Cancelar: ${cancelUrl}`;
    await this.growBusiness.sendSms(r.tenantId, r.customerPhone, body);
  }

  /** Self-cancel desde link en SMS. Verifica token, marca CANCELLED y
   *  avisa al tenant. Idempotente: si ya está cancelada, devuelve el
   *  estado actual sin re-notificar. */
  async selfCancel(token: string): Promise<{ ok: boolean; alreadyCancelled?: boolean; reservation: any }> {
    const rid = this.verifyCancelToken(token);
    if (!rid) throw new BadRequestException('Link inválido o expirado');
    const r = await this.prisma.reservation.findUnique({
      where: { id: rid },
      include: {
        zone: { select: { name: true } },
        tenant: { select: { brandName: true, whatsappPhone: true, phone: true } },
      },
    });
    if (!r) throw new NotFoundException('Reserva no encontrada');
    if (r.status === 'CANCELLED' || r.status === 'NO_SHOW' || r.status === 'COMPLETED') {
      return { ok: true, alreadyCancelled: true, reservation: this.publicReservationSummary(r) };
    }
    const updated = await this.prisma.reservation.update({
      where: { id: rid },
      data: { status: 'CANCELLED', cancelledAt: new Date() },
      include: {
        zone: { select: { name: true } },
        tenant: { select: { brandName: true, whatsappPhone: true, phone: true } },
      },
    });
    this.notifyTenantOfCustomerCancellation(updated as any).catch((e) =>
      this.logger.warn(`notifyTenantOfCustomerCancellation falló: ${(e as Error).message}`),
    );
    return { ok: true, reservation: this.publicReservationSummary(updated) };
  }

  /** Para mostrar al cliente en la página de cancelación. */
  async getPublicReservation(token: string) {
    const rid = this.verifyCancelToken(token);
    if (!rid) throw new BadRequestException('Link inválido o expirado');
    const r = await this.prisma.reservation.findUnique({
      where: { id: rid },
      include: {
        zone: { select: { name: true } },
        tenant: { select: { brandName: true, primaryColor: true, logoUrl: true } },
      },
    });
    if (!r) throw new NotFoundException('Reserva no encontrada');
    return this.publicReservationSummary(r);
  }

  /** Datos para el pase digital de confirmación. Incluye un QR payload
   *  con un protocolo propio que el scanner del staff puede leer. */
  async getPassData(token: string) {
    const rid = this.verifyPassToken(token);
    if (!rid) throw new BadRequestException('Link inválido o expirado');
    const r = await this.prisma.reservation.findUnique({
      where: { id: rid },
      include: {
        zone: { select: { name: true } },
        tenant: {
          select: {
            brandName: true,
            primaryColor: true,
            logoUrl: true,
            whatsappPhone: true,
            phone: true,
          },
        },
      },
    });
    if (!r) throw new NotFoundException('Reserva no encontrada');
    const summary = this.publicReservationSummary(r);
    return {
      ...summary,
      whatsappPhone: r.tenant?.whatsappPhone ?? r.tenant?.phone ?? null,
      qrPayload: `${QR_RESERVATION_PROTOCOL}${r.id}`,
    };
  }

  private publicReservationSummary(r: any) {
    return {
      id: r.id,
      customerName: r.customerName,
      party: r.party,
      date: r.date.toISOString().slice(0, 10),
      time: r.time,
      zone: r.zone?.name ?? null,
      status: r.status,
      brandName: r.tenant?.brandName ?? '',
      primaryColor: r.tenant?.primaryColor ?? null,
      logoUrl: r.tenant?.logoUrl ?? null,
    };
  }

  /** Manda SMS al tenant avisando que el CLIENTE canceló su reserva. */
  private async notifyTenantOfCustomerCancellation(r: any) {
    const dest = r.tenant?.whatsappPhone || r.tenant?.phone;
    if (!dest) return;
    const dateStr = r.date.toISOString().slice(0, 10);
    const zoneStr = r.zone?.name ? ` · ${r.zone.name}` : '';
    const body =
      `❌ RESERVA CANCELADA POR EL CLIENTE\n` +
      `${r.customerName} canceló su reserva.\n` +
      `📅 ${dateStr} a las ${r.time}${zoneStr} · ${r.party} pax\n` +
      `📞 ${r.customerPhone}\n` +
      `El slot vuelve a estar disponible.`;
    await this.growBusiness.sendSms(r.tenantId, dest, body);
  }

  /** Notifica al cliente cuando el negocio cancela su reserva. */
  private async notifyCustomerCancelled(reservationId: string) {
    const r = await this.prisma.reservation.findUnique({
      where: { id: reservationId },
      select: {
        tenantId: true,
        customerName: true,
        customerPhone: true,
        date: true,
        time: true,
        tenant: { select: { brandName: true, whatsappPhone: true, phone: true } },
      },
    });
    if (!r) return;
    const dateStr = r.date.toISOString().slice(0, 10);
    const contact = r.tenant.whatsappPhone || r.tenant.phone || '';
    const contactStr = contact ? `\nContactá a ${r.tenant.brandName}: ${contact}` : '';
    const body =
      `Hola ${r.customerName}, tu reserva en ${r.tenant.brandName} para el ${dateStr} a las ${r.time} fue cancelada.${contactStr}\n` +
      `Lamentamos las molestias.`;
    await this.growBusiness.sendSms(r.tenantId, r.customerPhone, body);
  }

  // ============================================================
  //                  LOYALTY: sello por reserva
  // ============================================================

  /** Otorga 1 sello al cliente cuando su reserva pasa a SEATED.
   *
   *  Encadena: claim atómico (Reservation.stampGrantedAt) → busca o crea
   *  el pass del cliente en la STAMPS card "principal" del tenant →
   *  inserta Stamp + actualiza pass.stampsCount → push wallet.
   *
   *  NO usamos StampsService.record() porque esa ruta es para scanner
   *  (PIN, anti-fraud rate limit, monto compra obligatorio). Esto es un
   *  flujo interno automatizado: skip-all-guards directo a DB.
   *
   *  Idempotent: el claim atómico (updateMany WHERE stampGrantedAt IS
   *  NULL) garantiza que solo el primer SEATED dispara el sello. Si el
   *  staff hace SEATED → PENDING → SEATED, el segundo no genera duplicado. */
  private async grantReservationStamp(reservationId: string) {
    const now = new Date();
    // Claim atómico
    const claim = await this.prisma.reservation.updateMany({
      where: { id: reservationId, stampGrantedAt: null, status: 'SEATED' },
      data: { stampGrantedAt: now },
    });
    if (claim.count === 0) return;

    const r = await this.prisma.reservation.findUnique({
      where: { id: reservationId },
      select: {
        id: true,
        tenantId: true,
        customerId: true,
        customerName: true,
      },
    });
    if (!r || !r.customerId) {
      this.logger.warn(`Reservation ${reservationId} sin customerId — skip stamp`);
      return;
    }

    // Resolver STAMPS card "principal" del tenant. Si no hay, skip
    // silenciosamente — el negocio no está usando fidelización todavía.
    const stampsCard = await this.prisma.card.findFirst({
      where: { tenantId: r.tenantId, type: 'STAMPS', isActive: true },
      orderBy: { createdAt: 'asc' },
      select: { id: true, stampsRequired: true },
    });
    if (!stampsCard) {
      this.logger.log(
        `Tenant ${r.tenantId} sin STAMPS card activa — skip sello para reserva ${reservationId}`,
      );
      return;
    }

    // Busca o crea el pass del customer en esa card. issueInternal hace
    // el findUnique + create con serial/qrToken/authToken correctamente
    // firmados (no podemos crear el pass crudo desde acá porque rompe
    // el HMAC signature del QR).
    const pass = await this.passes.issueInternal(stampsCard.id, r.customerId);
    if (!pass) return;

    if (pass.status === 'REVOKED') {
      this.logger.warn(`Pass ${pass.id} revoked — skip sello para reserva ${reservationId}`);
      return;
    }

    const newStamps = pass.stampsCount + 1;
    const required = stampsCard.stampsRequired ?? Number.MAX_SAFE_INTEGER;
    const completed = newStamps >= required;

    await this.prisma.$transaction([
      this.prisma.stamp.create({
        data: {
          tenantId: r.tenantId,
          passId: pass.id,
          customerId: r.customerId,
          action: 'STAMP',
          amount: 1,
          note: `Sello por reserva (${reservationId.slice(0, 8)})`,
        },
      }),
      this.prisma.pass.update({
        where: { id: pass.id },
        data: {
          stampsCount: newStamps,
          status: completed ? 'COMPLETED' : pass.status,
          lastActivityAt: now,
        },
      }),
    ]);

    // Push wallet fire-and-forget
    this.wallet.pushPassUpdate(pass.id).catch((e) =>
      this.logger.warn(`Wallet push fail tras sello-reserva: ${(e as Error).message}`),
    );

    this.logger.log(
      `Sello otorgado a ${r.customerName} (reserva ${reservationId}, pass ${pass.id}, ${newStamps}/${required === Number.MAX_SAFE_INTEGER ? '?' : required})`,
    );
  }

  // ============================================================
  //                  REMINDER CRON (24h antes)
  // ============================================================

  /** Cada 30 min busca reservas confirmadas para "mañana" (en UTC) que
   *  todavía no recibieron recordatorio y manda SMS al cliente.
   *
   *  Gate horario: solo dispara entre 14:00-22:00 UTC para evitar mandar
   *  recordatorios de madrugada en LATAM (≈ 08:00-16:00 hora local en
   *  CDMX/Bogota/Lima). Si más tenants se suman fuera de LATAM hay que
   *  agregar tenant.timezone y ajustar por zona.
   *
   *  Claim atómico: updateMany WHERE reminderSentAt IS NULL → si count=1
   *  somos los dueños del envío. Si el SMS falla, lo des-claimeamos para
   *  reintentar en la próxima vuelta. */
  @Cron(CronExpression.EVERY_30_MINUTES)
  async sendReminderCron() {
    const now = new Date();
    const hourUtc = now.getUTCHours();
    if (hourUtc < 14 || hourUtc >= 22) return;

    // "Mañana" en UTC: date = now + 1 día a las 12:00 UTC (mismo formato
    // de storage que createForTenant).
    const tomorrow = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 12, 0, 0),
    );

    const candidates = await this.prisma.reservation.findMany({
      where: {
        reminderSentAt: null,
        status: { in: ['CONFIRMED', 'PENDING'] },
        date: tomorrow,
      },
      include: {
        tenant: {
          select: { id: true, brandName: true },
        },
      },
      take: 200,
    });

    if (candidates.length === 0) return;
    this.logger.log(`Reminder cron: ${candidates.length} candidatos para mañana`);

    let sent = 0;
    let failed = 0;
    for (const r of candidates) {
      const claim = await this.prisma.reservation.updateMany({
        where: { id: r.id, reminderSentAt: null },
        data: { reminderSentAt: now },
      });
      if (claim.count === 0) continue; // otro worker se lo llevó

      const token = this.signCancelToken(r.id);
      const cancelUrl = `https://soyclubify.com/r/cancelar/${token}`;
      const body =
        `Hola ${r.customerName}! Te recordamos tu reserva en ${r.tenant.brandName} ` +
        `mañana a las ${r.time} para ${r.party} ${r.party === 1 ? 'persona' : 'personas'}. ` +
        `¡Te esperamos!\n\n` +
        `Si no podés asistir, cancelá aquí: ${cancelUrl}`;

      try {
        await this.growBusiness.sendSms(r.tenantId, r.customerPhone, body);
        sent++;
      } catch (e) {
        // Des-claim para reintento en la próxima vuelta del cron.
        await this.prisma.reservation.updateMany({
          where: { id: r.id },
          data: { reminderSentAt: null },
        });
        failed++;
        this.logger.warn(`Reminder failed for ${r.id}: ${(e as Error).message}`);
      }
    }
    this.logger.log(`Reminder cron: ${sent} enviados, ${failed} fallidos`);
  }
}
