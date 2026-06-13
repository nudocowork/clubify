import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
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

  async create(user: AuthUser, dto: ReservationDto, override?: string) {
    const tid = this.tid(user, override);
    return this.createForTenant(tid, dto, dto.channel ?? 'PHONE', { notify: true });
  }

  /** Crea reserva para un tenant — usado por admin y por endpoint público.
   *  Encadena: findOrCreate Customer por phone, crea reservation, notifica. */
  async createForTenant(
    tenantId: string,
    dto: ReservationDto,
    channel: ReservationChannel,
    opts: { notify: boolean },
  ) {
    this.assertValidDto(dto);
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
