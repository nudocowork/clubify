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
import { WhitelabelBrandService } from '../whitelabel/whitelabel-brand.service';
import { sign, verify } from 'jsonwebtoken';

const QR_RESERVATION_PROTOCOL = 'clubify-reservation:';

export type ZoneDto = {
  name: string;
  slug?: string;
  type?: string;
  position?: number;
  // Geometría explícita del recuadro (null = auto, derivado de las mesas).
  posX?: number | null;
  posY?: number | null;
  width?: number | null;
  height?: number | null;
  isActive?: boolean;
  locationId?: string | null;
};

export type TableDto = {
  zoneId?: string | null;
  locationId?: string | null;
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
  locationId?: string | null;
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
    private brand: WhitelabelBrandService,
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

  listZones(user: AuthUser, override?: string, locationId?: string | null) {
    const tid = this.tid(user, override);
    return this.prisma.reservationZone.findMany({
      where: {
        tenantId: tid,
        isActive: true,
        ...(locationId === null ? { locationId: null } : locationId ? { locationId } : {}),
      },
      orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
      include: {
        tables: { where: { isActive: true }, orderBy: { number: 'asc' } },
        location: { select: { id: true, name: true } },
      },
    });
  }

  async createZone(user: AuthUser, dto: ZoneDto, override?: string) {
    const tid = this.tid(user, override);
    const slug = (dto.slug || dto.name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    if (!slug) throw new BadRequestException('Slug invalido');
    return this.prisma.reservationZone.create({
      data: {
        tenantId: tid,
        locationId: dto.locationId ?? null,
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
        // Geometría: undefined = no tocar; null = volver a auto; number = fijar.
        posX: patch.posX === undefined ? undefined : patch.posX,
        posY: patch.posY === undefined ? undefined : patch.posY,
        width: patch.width === undefined ? undefined : patch.width,
        height: patch.height === undefined ? undefined : patch.height,
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

  listTables(user: AuthUser, override?: string, locationId?: string | null) {
    const tid = this.tid(user, override);
    return this.prisma.reservationTable.findMany({
      where: {
        tenantId: tid,
        isActive: true,
        ...(locationId === null ? { locationId: null } : locationId ? { locationId } : {}),
      },
      orderBy: { createdAt: 'asc' },
      include: { zone: true, location: { select: { id: true, name: true } } },
    });
  }

  async createTable(user: AuthUser, dto: TableDto, override?: string) {
    const tid = this.tid(user, override);
    // Si no se pasó locationId explícito pero la zona lo tiene, lo herda.
    let locationId = dto.locationId ?? null;
    if (!locationId && dto.zoneId) {
      const z = await this.prisma.reservationZone.findUnique({
        where: { id: dto.zoneId },
        select: { locationId: true },
      });
      locationId = z?.locationId ?? null;
    }
    return this.prisma.reservationTable.create({
      data: {
        tenantId: tid,
        zoneId: dto.zoneId ?? null,
        locationId,
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

  async list(
    user: AuthUser,
    filters: { date?: string; status?: ReservationStatus; locationId?: string | null } = {},
    override?: string,
  ) {
    const tid = this.tid(user, override);
    const where: any = { tenantId: tid };
    if (filters.date) {
      const [y, m, d] = filters.date.split('-').map(Number);
      const start = new Date(Date.UTC(y, m - 1, d, 0, 0, 0));
      const end = new Date(Date.UTC(y, m - 1, d, 23, 59, 59));
      where.date = { gte: start, lte: end };
    }
    if (filters.status) where.status = filters.status;
    if (filters.locationId === null) where.locationId = null;
    else if (filters.locationId) where.locationId = filters.locationId;
    const reservations = await this.prisma.reservation.findMany({
      where,
      orderBy: [{ date: 'asc' }, { time: 'asc' }],
      include: {
        table: true,
        zone: true,
        location: { select: { id: true, name: true } },
        customer: {
          select: {
            id: true,
            fullName: true,
            tags: true,
            birthday: true,
            totalOrdersAmount: true,
            totalOrdersCount: true,
          },
        },
      },
    });

    // Enriquecer cada reserva con labels dinámicos derivados del histórico
    // del customer (Frecuente, VIP, Primera visita, Cumpleaños, Alto valor).
    const customerIds = reservations.map((r) => r.customerId).filter((id): id is string => !!id);
    const reservationCounts = customerIds.length > 0
      ? await this.prisma.reservation.groupBy({
          by: ['customerId'],
          where: {
            tenantId: tid,
            customerId: { in: customerIds },
            status: { in: ['SEATED', 'COMPLETED'] },
          },
          _count: { _all: true },
        })
      : [];
    const countByCustomer = new Map<string, number>();
    reservationCounts.forEach((row) => {
      if (row.customerId) countByCustomer.set(row.customerId, row._count._all);
    });

    return reservations.map((r) => ({
      ...r,
      labels: ReservationsService.deriveLabels({
        customer: r.customer,
        reservationDate: r.date,
        completedReservations: r.customerId ? countByCustomer.get(r.customerId) ?? 0 : 0,
      }),
    }));
  }

  /** Genera array de labels visuales para la reserva. Heurísticas:
   *  - "Primera visita": el customer no tiene reservas SEATED/COMPLETED previas
   *  - "Frecuente": >= 5 reservas SEATED/COMPLETED previas
   *  - "VIP": tag manual o totalOrdersAmount > 500 USD equivalente
   *  - "Cumpleaños": birthday matches mes+día de la reserva
   *  - "Alto valor": totalOrdersAmount > 200 USD pero < VIP threshold */
  private static deriveLabels(input: {
    customer: { tags?: string[]; birthday?: Date | null; totalOrdersAmount?: any } | null;
    reservationDate: Date;
    completedReservations: number;
  }): string[] {
    const labels: string[] = [];
    const c = input.customer;
    if (!c) return labels;
    const manualTags = c.tags ?? [];
    if (manualTags.includes('VIP') || manualTags.includes('vip')) {
      labels.push('VIP');
    }
    const totalSpend = Number(c.totalOrdersAmount ?? 0);
    if (!labels.includes('VIP') && totalSpend > 500_000) labels.push('VIP');
    else if (totalSpend > 200_000) labels.push('Alto valor');
    if (input.completedReservations >= 5) labels.push('Frecuente');
    else if (input.completedReservations === 0) labels.push('Primera visita');
    if (c.birthday) {
      const b = new Date(c.birthday);
      const r = input.reservationDate;
      if (b.getUTCMonth() === r.getUTCMonth() && b.getUTCDate() === r.getUTCDate()) {
        labels.push('Cumpleaños');
      }
    }
    return labels;
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

    // FIX 2026-06-16 (review #12): la validación de capacidad + el create se
    // hacen juntos dentro de una transacción con un advisory lock por slot
    // (más abajo). Antes el check (assertSlotAvailable) y el create eran 2
    // statements separados → dos requests concurrentes para los últimos
    // lugares pasaban ambos el check y ambos insertaban (oversell /
    // doble-booking). El lock serializa el slot; el customer/location se
    // resuelven ANTES (no afectan capacidad).

    // FindOrCreate Customer por phone (CRM enrichment).
    // FIX 2026-06-12: skip si el phone es placeholder de walk-in
    // (vacío o prefijo "walkin-"). Antes creaba Customer huérfano con
    // phone fake → no se puede vincular al cliente real después.
    const phone = dto.customerPhone.trim();
    const isPlaceholderPhone = !phone || phone.startsWith('walkin-') || phone.length < 5;
    const customer = isPlaceholderPhone
      ? null
      : await this.findOrCreateCustomer(tenantId, phone, dto.customerName.trim(), dto.customerEmail);

    const [y, m, d] = dto.date.split('-').map(Number);
    // Mediodía UTC para evitar problemas de zona horaria al filtrar por día.
    const dateAtNoonUtc = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));

    // Multi-sede: si vino locationId, usarlo; sino, heredarlo de zone/table.
    let locationId = dto.locationId ?? null;
    if (!locationId && dto.zoneId) {
      const z = await this.prisma.reservationZone.findUnique({
        where: { id: dto.zoneId },
        select: { locationId: true },
      });
      locationId = z?.locationId ?? null;
    }
    if (!locationId && dto.tableId) {
      const t = await this.prisma.reservationTable.findUnique({
        where: { id: dto.tableId },
        select: { locationId: true },
      });
      locationId = t?.locationId ?? null;
    }

    // FIX 2026-06-12: si se crea con status final (CONFIRMED/SEATED/COMPLETED),
    // sellar los timestamps correspondientes. Antes el reservation quedaba con
    // status=SEATED pero seatedAt=null, lo que rompía reportes/auditoría.
    const now = new Date();
    const initStatus = dto.status ?? 'PENDING';
    const timestamps: any = {};
    if (initStatus === 'CONFIRMED' || initStatus === 'SEATED' || initStatus === 'COMPLETED') {
      timestamps.confirmedAt = now;
    }
    if (initStatus === 'SEATED' || initStatus === 'COMPLETED') {
      timestamps.seatedAt = now;
    }
    if (initStatus === 'COMPLETED') {
      timestamps.completedAt = now;
    }

    const reservation = await this.prisma.$transaction(async (tx) => {
      if (!opts.skipCapacityCheck) {
        // Advisory lock por slot (tenant+fecha+hora+zona/sede): serializa las
        // reservas concurrentes del mismo slot. Mientras una tx lo tiene, las
        // demás esperan → el assertSlotAvailable ve el estado committed
        // (incluidas las que acaban de confirmar) y no hay oversell.
        const lockKey = `resv:${tenantId}:${dto.date}:${dto.time}:${dto.zoneId ?? locationId ?? 'all'}`;
        await tx.$executeRawUnsafe(
          `SELECT pg_advisory_xact_lock(hashtext($1))`,
          lockKey,
        );
        await this.assertSlotAvailable(
          tenantId,
          dto.date,
          dto.time,
          dto.zoneId ?? null,
          dto.party,
          locationId,
        );
      }
      return tx.reservation.create({
        data: {
          tenantId,
          locationId,
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
          status: initStatus,
          ...timestamps,
        },
        include: { table: true, zone: true },
      });
    });

    if (opts.notify) {
      this.notifyTenant(reservation).catch((e) =>
        this.logger.warn(`notifyTenant falló (reservationId=${reservation.id}): ${(e as Error).message}`),
      );
    }
    // FIX 2026-06-12: side effects de status final en create.
    // PDF 2026-07-01 (P5): en el flujo de reservas NUNCA se le manda un mensaje
    // al cliente final. Todo aviso automático va SOLO al negocio (notifyTenant
    // arriba + recordatorio del cron). Antes, un status inicial CONFIRMED
    // disparaba un SMS al cliente (notifyCustomerConfirmed) — se elimina.
    if (initStatus === 'SEATED' || initStatus === 'COMPLETED') {
      this.grantReservationStamp(reservation.id).catch((e) =>
        this.logger.warn(
          `grantReservationStamp falló (reservationId=${reservation.id}): ${(e as Error).message}`,
        ),
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
    if (patch.status && patch.status !== r.status) {
      data.status = patch.status;
      if (patch.status === 'CONFIRMED' && !r.confirmedAt) {
        data.confirmedAt = now;
        // PDF 2026-07-01 (P5): NO se avisa al cliente al confirmar. El negocio
        // gestiona el seguimiento manualmente. (Antes: notifyCustomerConfirmed.)
      }
      if (patch.status === 'SEATED' && !r.seatedAt) {
        data.seatedAt = now;
        if (!r.stampGrantedAt) grantStamp = true;
      }
      if (patch.status === 'COMPLETED' && !r.completedAt) data.completedAt = now;
      // Cancelación desde el panel = la hace el negocio. NO se le manda mensaje
      // al cliente (antes salía uno con un número de contacto incorrecto). El
      // negocio ya sabe que canceló; el self-cancel del cliente sí avisa al
      // negocio (notifyTenantOfCustomerCancellation).
      if (patch.status === 'CANCELLED' && !r.cancelledAt) {
        data.cancelledAt = now;
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
      // FIX 2026-06-12: race-safe append. Antes el check-then-act
      // (if !has 'reserva' → push) podía duplicar el tag si dos
      // reservas del mismo phone llegaban concurrentes. updateMany con
      // NOT { has: 'reserva' } es atómico en Postgres — si ya está el
      // tag el count queda en 0 y nada se duplica.
      await this.prisma.customer.updateMany({
        where: { id: existing.id, NOT: { tags: { has: 'reserva' } } },
        data: { tags: { push: 'reserva' } },
      });
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

  /** Default slots públicos cuando el tenant no configuró slots propios. */
  static readonly DEFAULT_SLOTS = [
    '13:00', '13:30', '14:00', '14:30', '21:00', '21:30', '22:00',
  ];

  /** Resuelve los slots configurados del tenant, con fallback al default
   *  si el array está vacío o el tenant no se encuentra. Los slots se
   *  ordenan asc por hora. */
  async getTenantSlots(tenantId: string): Promise<string[]> {
    const t = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { reservationSlots: true },
    });
    const configured = t?.reservationSlots ?? [];
    if (configured.length === 0) return ReservationsService.DEFAULT_SLOTS;
    return [...configured].sort();
  }

  /** Persiste los slots configurados del tenant. Array vacío restablece
   *  al default. */
  async setTenantSlots(tenantId: string, slots: string[]): Promise<void> {
    await this.prisma.tenant.update({
      where: { id: tenantId },
      data: { reservationSlots: slots },
    });
  }

  /** Resuelve el locationId de una zona, si la zona tiene una asignada.
   *  Usado por slot validation para scopear capacity/occupancy a sede. */
  private async resolveZoneLocation(zoneId: string | null): Promise<string | null> {
    if (!zoneId) return null;
    const z = await this.prisma.reservationZone.findUnique({
      where: { id: zoneId },
      select: { locationId: true },
    });
    return z?.locationId ?? null;
  }

  /** Suma de seats de mesas activas y no bloqueadas. Si zoneId es null,
   *  cuenta todas las mesas del tenant (filtradas por locationId si se
   *  pasa). Si la zona no tiene mesas (o el tenant no tiene mesas
   *  configuradas), retorna 0.
   *  FIX 2026-06-12: agrega filtro por locationId para multi-sede. Antes
   *  cuando no se pasaba zoneId, sumaba capacidad GLOBAL del tenant
   *  cruzando sedes → overselling. */
  private async getCapacity(
    tenantId: string,
    zoneId: string | null,
    locationId: string | null = null,
  ): Promise<number> {
    const tables = await this.prisma.reservationTable.findMany({
      where: {
        tenantId,
        isActive: true,
        isBlocked: false,
        ...(zoneId ? { zoneId } : {}),
        ...(locationId ? { locationId } : {}),
      },
      select: { seats: true },
    });
    return tables.reduce((acc, t) => acc + (t.seats || 0), 0);
  }

  /** Suma de party de reservas que solapan con (date, time) por menos de
   *  SLOT_WINDOW_MIN. Solo cuenta status activos (no CANCELLED/COMPLETED/
   *  NO_SHOW). Si zoneId está provisto, filtra por zona; si locationId
   *  está provisto, filtra por sede (multi-sede).
   *  FIX 2026-06-12: agrega filtro por locationId. */
  private async getOccupancy(
    tenantId: string,
    date: string,
    time: string,
    zoneId: string | null,
    locationId: string | null = null,
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
        ...(locationId ? { locationId } : {}),
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
   *  (date, time, zoneId, locationId). Si el tenant no tiene mesas
   *  configuradas la validación se salta (bootstrap mode).
   *  FIX 2026-06-12: deriva locationId de la zona si no se pasa explícito,
   *  para que multi-sede no cruce capacidad entre locales. */
  async assertSlotAvailable(
    tenantId: string,
    date: string,
    time: string,
    zoneId: string | null,
    party: number,
    locationId: string | null = null,
  ): Promise<void> {
    const effectiveLocation = locationId ?? (await this.resolveZoneLocation(zoneId));
    const capacity = await this.getCapacity(tenantId, zoneId, effectiveLocation);
    if (capacity === 0) {
      if (zoneId) {
        throw new ConflictException('Esta zona no tiene mesas disponibles');
      }
      this.logger.warn(
        `Tenant ${tenantId} sin mesas configuradas — saltando validación de slot`,
      );
      return;
    }
    const occupied = await this.getOccupancy(tenantId, date, time, zoneId, effectiveLocation);
    const remaining = capacity - occupied;
    if (remaining < party) {
      throw new ConflictException(
        remaining > 0
          ? `Solo quedan ${remaining} lugares en este horario. Probá otra hora.`
          : 'Este horario está completo. Probá otra hora.',
      );
    }
  }

  /** Devuelve disponibilidad por slot para una fecha + party.
   *  FIX 2026-06-12: agrega locationId param para multi-sede. */
  async getAvailability(
    tenantId: string,
    date: string,
    party: number,
    zoneId: string | null = null,
    locationId: string | null = null,
  ): Promise<{ time: string; available: boolean; remaining: number }[]> {
    const effectiveLocation = locationId ?? (await this.resolveZoneLocation(zoneId));
    const slots = await this.getTenantSlots(tenantId);
    const capacity = await this.getCapacity(tenantId, zoneId, effectiveLocation);
    if (capacity === 0) {
      return slots.map((time) => ({
        time,
        available: true,
        remaining: 99,
      }));
    }
    const results = await Promise.all(
      slots.map(async (time) => {
        const occupied = await this.getOccupancy(tenantId, date, time, zoneId, effectiveLocation);
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
      select: {
        brandName: true,
        whatsappReservationsPhone: true,
        whatsappPhone: true,
        phone: true,
        growBusinessLocationId: true,
        growBusinessApiKey: true,
      },
    });
    // PDF Software 2026-06-29: el aviso de reserva va al "Número receptor de
    // reservas" si está configurado; sino cae al WhatsApp general y luego al
    // teléfono del negocio.
    const dest =
      tenant?.whatsappReservationsPhone ||
      tenant?.whatsappPhone ||
      tenant?.phone;
    if (!dest) {
      this.logger.warn(
        `Tenant ${reservation.tenantId} sin número receptor de reservas — no se envió notificación`,
      );
      return;
    }
    // Datos completos (incluye la mesa elegida, que no viaja en el objeto).
    const full = await this.prisma.reservation.findUnique({
      where: { id: reservation.id },
      select: {
        table: { select: { number: true } },
        zone: { select: { name: true } },
      },
    });
    const body = this.buildReservationNotifyBody({
      brandName: tenant?.brandName ?? '',
      customerName: reservation.customerName,
      customerPhone: reservation.customerPhone,
      party: reservation.party,
      date: reservation.date,
      time: reservation.time,
      notes: reservation.notes,
      zoneName: full?.zone?.name ?? reservation.zone?.name ?? null,
      tableNumber: full?.table?.number ?? null,
    });
    // PDF 2026-06-30: envío robusto. Usa las credenciales de Grow Business del
    // negocio si las tiene; si no, cae a la cuenta GLOBAL de la plataforma.
    // Siempre enruta por switch 2 (#switch_unique|2|...).
    const creds = await this.resolveReservationSmsCreds(tenant);
    if (!creds) {
      this.logger.warn(
        `Sin credenciales Grow Business (negocio ni global) — no se envió aviso de reserva ${reservation.id}`,
      );
      return;
    }
    try {
      const res = await this.growBusiness.sendSmsWithCreds(creds, dest, body);
      if (res.ok) {
        await this.prisma.reservation.update({
          where: { id: reservation.id },
          data: { notifiedAt: new Date() },
        });
      } else {
        this.logger.warn(
          `Aviso de reserva no enviado (${reservation.id}): ${res.message ?? 'desconocido'}`,
        );
      }
    } catch (e) {
      this.logger.warn(`SMS notif reserva falló: ${(e as Error).message}`);
    }
  }

  /** Cuerpo del SMS/WhatsApp de aviso de reserva (compartido con la prueba). */
  private buildReservationNotifyBody(d: {
    brandName: string;
    customerName: string;
    customerPhone: string;
    party: number;
    date: Date;
    time: string;
    notes: string | null;
    zoneName: string | null;
    tableNumber: string | null;
  }): string {
    const dateStr = d.date.toISOString().slice(0, 10);
    const zoneStr = d.zoneName ? `\n📍 Zona: ${d.zoneName}` : '';
    const tableStr = d.tableNumber ? `\n🍽️ Mesa: ${d.tableNumber}` : '';
    const notesStr = d.notes ? `\n📝 Notas: ${d.notes}` : '';
    return (
      `🔔 NUEVA RESERVA · ${d.brandName}\n` +
      `Cliente: ${d.customerName}\n` +
      `📞 ${d.customerPhone}\n` +
      `👥 ${d.party} personas\n` +
      `📅 ${dateStr} a las ${d.time}` +
      zoneStr +
      tableStr +
      notesStr +
      `\n\nConfirma manualmente con el cliente.`
    );
  }

  /**
   * Resuelve las credenciales de Grow Business para el aviso de reserva:
   * credenciales propias del negocio si está conectado, si no la cuenta GLOBAL
   * de la plataforma (GENERAL). Siempre switch 2 (el aviso de reserva enruta
   * por el número de soporte/operativo).
   */
  private async resolveReservationSmsCreds(tenant: {
    growBusinessLocationId?: string | null;
    growBusinessApiKey?: string | null;
  } | null): Promise<{ locationId: string; apiKey: string; switchNumber: number } | null> {
    if (tenant?.growBusinessLocationId && tenant?.growBusinessApiKey) {
      return {
        locationId: tenant.growBusinessLocationId,
        apiKey: tenant.growBusinessApiKey,
        switchNumber: 2,
      };
    }
    const acc =
      (await this.prisma.growBusinessAccount.findFirst({
        where: { purpose: 'GENERAL', deletedAt: null },
        orderBy: { createdAt: 'asc' },
        select: { locationId: true, apiKey: true },
      })) ??
      (await this.prisma.growBusinessAccount.findFirst({
        where: { deletedAt: null },
        orderBy: { createdAt: 'asc' },
        select: { locationId: true, apiKey: true },
      }));
    if (acc) {
      return { locationId: acc.locationId, apiKey: acc.apiKey, switchNumber: 2 };
    }
    return null;
  }

  /**
   * Envía una notificación de PRUEBA al número receptor de reservas del negocio
   * (botón "Enviar prueba" en /app/settings#reservas). PDF 2026-06-30.
   */
  async sendTestNotification(user: AuthUser) {
    if (!user.tenantId) {
      throw new BadRequestException('Sesión sin negocio.');
    }
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: user.tenantId },
      select: {
        brandName: true,
        whatsappReservationsPhone: true,
        whatsappPhone: true,
        phone: true,
        growBusinessLocationId: true,
        growBusinessApiKey: true,
      },
    });
    const dest =
      tenant?.whatsappReservationsPhone ||
      tenant?.whatsappPhone ||
      tenant?.phone;
    if (!dest) {
      throw new BadRequestException(
        'Configura primero el número receptor de reservas y guárdalo.',
      );
    }
    const creds = await this.resolveReservationSmsCreds(tenant);
    if (!creds) {
      throw new BadRequestException(
        'No hay credenciales de Grow Business configuradas (marca/plataforma).',
      );
    }
    const body =
      `🔔 PRUEBA · ${tenant?.brandName ?? ''}\n` +
      `Esta es una notificación de prueba del sistema de reservas.\n` +
      `Si la recibes, el número receptor está bien configurado. ✅`;
    const res = await this.growBusiness
      .sendSmsWithCreds(creds, dest, body)
      .catch((e) => ({ ok: false as const, message: (e as Error).message }));
    return {
      ok: res.ok,
      dest,
      message: res.ok
        ? 'Notificación de prueba enviada.'
        : `No se pudo enviar: ${('message' in res && res.message) || 'error desconocido'}`,
    };
  }

  // ============================================================
  //                       DAILY KPIs (Agenda header)
  // ============================================================

  /** KPIs para la cabecera de Agenda del día. Devuelve totales del día +
   *  comparación con ayer, peak hour, ocupación %, no-show %. */
  async dailyKpis(
    user: AuthUser,
    params: { date: string; locationId?: string | null; tenantId?: string },
  ) {
    const tid = this.tid(user, params.tenantId);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(params.date)) {
      throw new BadRequestException('date YYYY-MM-DD requerido');
    }
    const [y, m, d] = params.date.split('-').map(Number);
    const start = new Date(Date.UTC(y, m - 1, d, 0, 0, 0));
    const end = new Date(Date.UTC(y, m - 1, d, 23, 59, 59));
    const yesterdayStart = new Date(Date.UTC(y, m - 1, d - 1, 0, 0, 0));
    const yesterdayEnd = new Date(Date.UTC(y, m - 1, d - 1, 23, 59, 59));

    const baseWhere: any = { tenantId: tid };
    if (params.locationId) baseWhere.locationId = params.locationId;

    const [today, yesterday] = await Promise.all([
      this.prisma.reservation.findMany({
        where: { ...baseWhere, date: { gte: start, lte: end } },
        select: { id: true, party: true, time: true, status: true },
      }),
      this.prisma.reservation.findMany({
        where: { ...baseWhere, date: { gte: yesterdayStart, lte: yesterdayEnd } },
        select: { id: true },
      }),
    ]);

    const totalToday = today.length;
    const totalYesterday = yesterday.length;
    const delta = totalToday - totalYesterday;

    const activeStatuses = ['PENDING', 'CONFIRMED', 'SEATED', 'COMPLETED'];
    const pax = today
      .filter((r) => activeStatuses.includes(r.status))
      .reduce((s, r) => s + r.party, 0);

    const noShow = today.filter((r) => r.status === 'NO_SHOW').length;
    const resolved = today.filter((r) => r.status !== 'PENDING').length;
    const noShowRate = resolved > 0 ? (noShow / resolved) * 100 : 0;

    // Peak hour: ventana de 2h con más pax (asumiendo turnover 2h)
    const byHour: Record<number, number> = {};
    today
      .filter((r) => activeStatuses.includes(r.status))
      .forEach((r) => {
        const h = parseInt(r.time.slice(0, 2), 10);
        byHour[h] = (byHour[h] || 0) + r.party;
      });
    let peakHour = 0;
    let peakPax = 0;
    Object.entries(byHour).forEach(([h, p]) => {
      if (p > peakPax) {
        peakPax = p;
        peakHour = parseInt(h, 10);
      }
    });

    // Capacidad para % ocupación: sum seats de todas las mesas activas
    // de la sede (o del tenant si no se pasó location).
    const tables = await this.prisma.reservationTable.findMany({
      where: {
        tenantId: tid,
        isActive: true,
        isBlocked: false,
        ...(params.locationId ? { locationId: params.locationId } : {}),
      },
      select: { seats: true },
    });
    const totalCapacity = tables.reduce((s, t) => s + (t.seats || 0), 0);
    // Ocupación = peak pax sobre capacidad total (no por slot porque la
    // capacidad rota durante el día).
    const occupancyPct = totalCapacity > 0
      ? Math.min(100, Math.round((peakPax / totalCapacity) * 100))
      : 0;

    return {
      date: params.date,
      reservations: { count: totalToday, delta },
      pax: { expected: pax },
      occupancy: {
        percent: occupancyPct,
        peakHour: peakHour > 0 ? `${String(peakHour).padStart(2, '0')}:00–${String(peakHour + 1).padStart(2, '0')}:00` : null,
      },
      noShow: {
        count: noShow,
        percent: Math.round(noShowRate * 10) / 10,
      },
    };
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

  // PDF 2026-07-01 (P5): ELIMINADO notifyCustomerConfirmed. En el flujo de
  // reservas NUNCA se contacta al cliente final por SMS/WhatsApp; todo aviso
  // automático va al negocio (notifyTenant + recordatorio del cron). El cliente
  // obtiene su pase digital vía la respuesta web/QR, no por mensaje.

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
        table: { select: { number: true } },
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
      tableNumber: r.table?.number ?? null,
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

  // PDF 2026-07-01 (P5): ELIMINADO notifyCustomerCancelled (antes avisaba al
  // cliente final por SMS). Nunca se contacta al cliente en el flujo de
  // reservas. La cancelación del cliente sí avisa al negocio
  // (notifyTenantOfCustomerCancellation, arriba).

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
    // Pre-check: necesitamos customerId antes de claimear stampGrantedAt.
    // Si la reserva no tiene customer asociado, NO hacemos el claim — sino
    // dejamos `stampGrantedAt=now` y un futuro vínculo (PATCH customerId)
    // ya no podrá otorgar el sello (claim WHERE stampGrantedAt:null falla).
    const r = await this.prisma.reservation.findUnique({
      where: { id: reservationId },
      select: {
        id: true,
        tenantId: true,
        customerId: true,
        customerName: true,
      },
    });
    if (!r) return;
    if (!r.customerId) {
      this.logger.log(
        `Reservation ${reservationId} sin customerId — skip stamp (no se claimea)`,
      );
      return;
    }

    // Claim atómico (idempotent contra dobles llamadas concurrentes).
    const claim = await this.prisma.reservation.updateMany({
      where: { id: reservationId, stampGrantedAt: null, status: 'SEATED' },
      data: { stampGrantedAt: now },
    });
    if (claim.count === 0) return;

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

  /**
   * Scan público del QR del pase de reserva. El scanner del staff llama a
   * verifyQr → detecta el prefijo `clubify-reservation:` → delega acá.
   *
   * Flow:
   *  1. Valida que la reserva existe y pertenece al tenant del operario
   *  2. Si todavía no está SEATED, transición → SEATED (idempotent)
   *  3. Dispara grantReservationStamp síncrono (no fire-and-forget) para
   *     que la response incluya el Pass de sellos resultante.
   *  4. Si el customer ya tenía un Pass en la STAMPS card, NO se duplica
   *     (issueInternal usa el cardId_customerId UNIQUE como findOrCreate).
   *
   * Retorna el mismo shape que el scan normal de stamps: `{ pass, recent }`.
   */
  async handleScannedReservation(user: AuthUser, reservationId: string) {
    const r = await this.prisma.reservation.findUnique({
      where: { id: reservationId },
      include: { table: true, zone: true },
    });
    if (!r) throw new NotFoundException('Reserva no encontrada');
    if (user.role !== 'SUPER_ADMIN' && user.tenantId !== r.tenantId) {
      throw new ForbiddenException('Reserva de otro negocio');
    }

    // Guard explícito: reservas canceladas o no-show no pueden ser
    // marcadas SEATED. El scanner debe devolver error claro al staff,
    // no "ok" silencioso (que generaba confusión: parecía exitoso pero
    // el updateMany no aplicaba nada).
    if (r.status === 'CANCELLED') {
      throw new BadRequestException('Esta reserva fue cancelada');
    }
    if (r.status === 'NO_SHOW') {
      throw new BadRequestException('Esta reserva fue marcada como no asistió');
    }

    // Transición a SEATED si todavía no lo está (idempotent).
    if (r.status !== 'SEATED' && r.status !== 'COMPLETED') {
      const now = new Date();
      await this.prisma.reservation.updateMany({
        where: { id: reservationId, status: { in: ['PENDING', 'CONFIRMED'] } },
        data: { status: 'SEATED', seatedAt: now },
      });
    }

    // PDF 2026-06-30: escanear el pase de reserva SOLO confirma la asistencia
    // (SEATED). NO se otorga ningún sello ni se crea tarjeta — si el cliente ya
    // tiene tarjeta de sellos del local, no se le suma nada. Devolvemos su
    // tarjeta existente (solo lectura) para que el staff la vea, sin modificarla.

    // Buscar el Pass que quedó (puede no existir si el tenant no tiene
    // STAMPS card configurada — devolvemos respuesta especial).
    if (!r.customerId) {
      return {
        reservation: {
          id: r.id,
          customerName: r.customerName,
          party: r.party,
          date: r.date,
          time: r.time,
          tableNumber: r.table?.number ?? null,
          zoneName: r.zone?.name ?? null,
        },
        pass: null,
        recent: [],
        message: 'Reserva confirmada — el cliente no tiene Customer asociado.',
      };
    }

    const stampsCard = await this.prisma.card.findFirst({
      where: { tenantId: r.tenantId, type: 'STAMPS', isActive: true },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    if (!stampsCard) {
      return {
        reservation: {
          id: r.id,
          customerName: r.customerName,
          party: r.party,
          date: r.date,
          time: r.time,
          tableNumber: r.table?.number ?? null,
          zoneName: r.zone?.name ?? null,
        },
        pass: null,
        recent: [],
        message: 'Reserva confirmada — el negocio aún no tiene tarjeta de fidelización.',
      };
    }

    const pass = await this.prisma.pass.findUnique({
      where: { cardId_customerId: { cardId: stampsCard.id, customerId: r.customerId } },
      include: {
        card: true,
        customer: true,
        tenant: { select: { brandName: true, primaryColor: true, logoUrl: true } },
      },
    });
    if (!pass) {
      return {
        reservation: {
          id: r.id,
          customerName: r.customerName,
          party: r.party,
          date: r.date,
          time: r.time,
          tableNumber: r.table?.number ?? null,
          zoneName: r.zone?.name ?? null,
        },
        pass: null,
        recent: [],
      };
    }

    const recent = await this.prisma.stamp.findMany({
      where: { passId: pass.id },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });

    return { pass, recent };
  }

  /**
   * Cron de auto check-in: si una reserva pasa de 60 minutos de su hora
   * sin haber sido SEATED manualmente, la marcamos como SEATED. Cubre el caso
   * "el cliente llegó pero el staff no escaneó el pase".
   * PDF 2026-06-30: la asistencia ya NO otorga sellos de fidelización.
   */
  @Cron(CronExpression.EVERY_5_MINUTES)
  async autoSeatOverdueReservations() {
    const now = new Date();
    const cutoffMs = 60 * 60 * 1000; // 60 minutos

    // Candidatos: PENDING/CONFIRMED cuyo momento real (date+time) está
    // más de 60 min en el pasado. Ventana ESTRICTA: solo reservas
    // creadas en las últimas 6h. Esto bloquea el caso "admin importa
    // reservas históricas y el cron las marca SEATED otorgando 200
    // sellos espurios". Las reservas que llevan más de 6h sin ser
    // marcadas por el staff (y sin scanner) son mejor dejarlas en
    // su estado original — el staff puede marcarlas manualmente.
    const sixHoursAgo = new Date(now.getTime() - 6 * 60 * 60 * 1000);
    const candidates = await this.prisma.reservation.findMany({
      where: {
        status: { in: ['PENDING', 'CONFIRMED'] },
        createdAt: { gte: sixHoursAgo },
      },
      select: {
        id: true,
        date: true,
        time: true,
        tenantId: true,
        createdAt: true,
        tenant: { select: { timezone: true } },
      },
      take: 200,
    });

    let processed = 0;
    for (const r of candidates) {
      const moment = ReservationsService.reservationMomentUtc(
        r.date,
        r.time,
        r.tenant?.timezone || 'America/Bogota',
      );
      const ageMs = now.getTime() - moment.getTime();
      if (ageMs < cutoffMs) continue;

      // Transición atómica: solo si todavía es PENDING/CONFIRMED.
      const claim = await this.prisma.reservation.updateMany({
        where: { id: r.id, status: { in: ['PENDING', 'CONFIRMED'] } },
        data: { status: 'SEATED', seatedAt: now },
      });
      if (claim.count === 0) continue;
      processed++;
      // PDF 2026-06-30: la asistencia ya NO otorga sellos (solo marca SEATED).
    }
    if (processed > 0) {
      this.logger.log(`Auto-seat cron: ${processed} reservas marcadas SEATED automáticamente`);
    }
  }

  // ============================================================
  //                  REMINDER CRON (24h antes)
  // ============================================================

  /** Cada 30 min busca reservas próximas que no recibieron recordatorio
   *  y manda SMS al cliente.
   *
   *  Fix 2026-06-12: antes matcheaba exactamente `date == tomorrow_UTC`,
   *  lo que perdía reservas creadas tarde en el día para el día siguiente
   *  (la ventana 14-22 UTC ya había pasado y al día siguiente el "tomorrow"
   *  era otro). Ahora el query agarra cualquier reserva en [today,
   *  day-after-tomorrow] y filtra por timestamp real combinando date+time
   *  con la timezone IANA del tenant (`tenant.timezone`), con fallback
   *  a `America/Bogota` para tenants legacy sin TZ explícita.
   *
   *  Gate horario: solo dispara entre 14:00-22:00 UTC para evitar mandar
   *  recordatorios de madrugada en LATAM (≈ 08:00-16:00 hora local en
   *  CDMX/Bogota/Lima).
   *
   *  Ventana de envío: el recordatorio sale entre 6h y 28h antes del
   *  momento real de la reserva. Eso da cobertura completa para reservas
   *  creadas con cualquier antelación.
   *
   *  Claim atómico: updateMany WHERE reminderSentAt IS NULL → si count=1
   *  somos los dueños del envío. Si el SMS falla, lo des-claimeamos para
   *  reintentar en la próxima vuelta. */
  @Cron(CronExpression.EVERY_30_MINUTES)
  async sendReminderCron() {
    const now = new Date();
    const hourUtc = now.getUTCHours();
    if (hourUtc < 14 || hourUtc >= 22) return;

    const todayStart = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0),
    );
    const dayAfterTomorrowEnd = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 2, 23, 59, 59),
    );

    const candidates = await this.prisma.reservation.findMany({
      where: {
        reminderSentAt: null,
        status: { in: ['CONFIRMED', 'PENDING'] },
        date: { gte: todayStart, lte: dayAfterTomorrowEnd },
      },
      include: {
        tenant: {
          select: {
            id: true,
            brandName: true,
            whatsappPhone: true,
            phone: true,
            timezone: true,
          },
        },
        zone: { select: { name: true } },
        table: { select: { number: true } },
      },
      take: 500,
    });

    if (candidates.length === 0) return;

    let sent = 0;
    let failed = 0;
    let skipped = 0;
    for (const r of candidates) {
      const moment = ReservationsService.reservationMomentUtc(
        r.date,
        r.time,
        r.tenant?.timezone || 'America/Bogota',
      );
      const hoursUntil = (moment.getTime() - now.getTime()) / (1000 * 60 * 60);
      // Ventana: entre 6h y 28h antes del momento real de la reserva.
      if (hoursUntil < 6 || hoursUntil > 28) {
        skipped++;
        continue;
      }

      // El recordatorio va al NEGOCIO (no al cliente). El negocio decide
      // si contacta al cliente. Mensaje incluye nombre/fecha/hora/mesa/tel.
      const dest = r.tenant.whatsappPhone || r.tenant.phone;
      if (!dest) {
        skipped++;
        this.logger.warn(
          `Reminder reservation ${r.id}: tenant sin whatsappPhone/phone, skip`,
        );
        continue;
      }

      const claim = await this.prisma.reservation.updateMany({
        where: { id: r.id, reminderSentAt: null },
        data: { reminderSentAt: now },
      });
      if (claim.count === 0) continue;

      const dateStr = r.date.toISOString().slice(0, 10);
      const whenStr = hoursUntil < 18 ? 'hoy' : `el ${dateStr}`;
      const tableStr = r.table?.number
        ? ` · Mesa ${r.table.number}`
        : r.zone?.name
        ? ` · ${r.zone.name}`
        : '';
      const body =
        `🔔 RECORDATORIO RESERVA · ${r.tenant.brandName}\n` +
        `${r.customerName} · ${r.party} ${r.party === 1 ? 'persona' : 'personas'}\n` +
        `📅 ${whenStr} a las ${r.time}${tableStr}\n` +
        `📞 ${r.customerPhone}\n\n` +
        `Contacta al cliente para confirmar asistencia.`;

      try {
        await this.growBusiness.sendSms(r.tenantId, dest, body);
        sent++;
      } catch (e) {
        await this.prisma.reservation.updateMany({
          where: { id: r.id },
          data: { reminderSentAt: null },
        });
        failed++;
        this.logger.warn(`Reminder failed for ${r.id}: ${(e as Error).message}`);
      }
    }
    if (sent + failed > 0 || skipped > 0) {
      this.logger.log(
        `Reminder cron: ${sent} enviados, ${failed} fallidos, ${skipped} fuera de ventana`,
      );
    }
  }

  /** Combina date (UTC noon) + time (HH:MM en TZ local del tenant) y
   *  devuelve el instante UTC que corresponde a esa fecha+hora EN la
   *  timezone IANA del tenant. Maneja DST: cada call computa el offset
   *  para ese instante específico, no asume offset fijo.
   *
   *  Algoritmo: tomamos "h:m" como si fuera UTC, vemos cómo se renderiza
   *  esa instante en la TZ, y la diferencia es el offset que aplicamos.
   */
  private static reservationMomentUtc(
    date: Date,
    time: string,
    timezone = 'America/Bogota',
  ): Date {
    const [h, m] = time.split(':').map(Number);
    const y = date.getUTCFullYear();
    const mo = date.getUTCMonth();
    const d = date.getUTCDate();
    const asUtc = Date.UTC(y, mo, d, h, m, 0);
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
    const tzY = get('year');
    const tzMo = get('month') - 1;
    const tzD = get('day');
    let tzH = get('hour');
    const tzM = get('minute');
    const tzS = get('second');
    // Intl puede devolver "24" en hour12=false a medianoche.
    if (tzH === 24) tzH = 0;
    const projected = Date.UTC(tzY, tzMo, tzD, tzH, tzM, tzS);
    const offset = projected - asUtc;
    return new Date(asUtc - offset);
  }
}
