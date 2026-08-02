import {
  BadRequestException,
  Body,
  Controller,
  DefaultValuePipe,
  Get,
  NotFoundException,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Response } from 'express';
import { IsEmail, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';
import { ReservationsService } from './reservations.service';
import { Public } from '../common/decorators/public.decorator';
import { PrismaService } from '../common/prisma/prisma.service';
import { GoogleWalletService } from '../wallet/google-wallet.service';
import { WalletService } from '../wallet/wallet.service';
import { WhitelabelBrandService } from '../whitelabel/whitelabel-brand.service';

class PublicReservationBody {
  @IsString() @MaxLength(120) customerName!: string;
  @IsString() @MaxLength(40) customerPhone!: string;
  @IsOptional() @IsEmail() customerEmail?: string;
  @IsInt() @Min(1) @Max(20) party!: number;
  @Matches(/^\d{4}-\d{2}-\d{2}$/) date!: string;
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/) time!: string;
  @IsOptional() @IsString() @MaxLength(500) notes?: string;
  @IsOptional() @IsString() zoneSlug?: string;
  // PDF Software 2026-06-29: mesa específica elegida por el cliente (opcional).
  @IsOptional() @IsString() tableId?: string;
  // F2 (2026-07-31): sede elegida en el flujo público (si el negocio tiene >1).
  @IsOptional() @IsString() locationId?: string;
}

@Controller('public/reservations')
export class PublicReservationsController {
  constructor(
    private svc: ReservationsService,
    private prisma: PrismaService,
    private googleWallet: GoogleWalletService,
    private wallet: WalletService,
    private brand: WhitelabelBrandService,
  ) {}

  /** Devuelve detalles de la reserva para mostrar antes de cancelar.
   *  El token debe haber sido emitido por signCancelToken. */
  @Get('cancel/:token')
  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  async getCancel(@Param('token') token: string) {
    return this.svc.getPublicReservation(token);
  }

  /** Pase digital de confirmación — incluye QR scaneable por el staff. */
  @Get('pase/:token')
  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 20 } })
  async getPass(@Param('token') token: string) {
    return this.svc.getPassData(token);
  }

  /** Devuelve el save URL de Google Wallet para una reserva. El frontend
   *  detecta UA Android y muestra el botón "Añadir a Google Wallet". */
  @Get('pase/:token/google-wallet')
  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  async getGoogleWalletUrl(@Param('token') token: string) {
    const reservationId = this.svc.verifyPassToken(token);
    if (!reservationId) {
      throw new BadRequestException('Link inválido o expirado');
    }
    const url = await this.googleWallet.generateReservationSaveUrl(
      reservationId,
    );
    return { url };
  }

  /** Genera .pkpass para Apple Wallet de la reserva. El frontend detecta
   *  UA iOS y muestra el botón "Añadir a Apple Wallet". Throttle bajo
   *  porque cada call genera+firma un pkpass nuevo (costoso). */
  @Get('pase/:token/apple-wallet')
  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 6 } })
  async getApplePass(
    @Param('token') token: string,
    @Res() res: Response,
  ): Promise<void> {
    const reservationId = this.svc.verifyPassToken(token);
    if (!reservationId) {
      throw new BadRequestException('Link inválido o expirado');
    }
    const buf = await this.wallet.generateReservationPkpass(reservationId);
    res.setHeader('Content-Type', 'application/vnd.apple.pkpass');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="reserva-${reservationId.slice(0, 8)}.pkpass"`,
    );
    res.setHeader('Cache-Control', 'no-store');
    res.end(buf);
  }

  /** Cancela la reserva si el token es válido. Idempotente: si ya
   *  estaba cancelada o completada, devuelve el estado actual. */
  @Post('cancel/:token')
  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  async postCancel(@Param('token') token: string) {
    return this.svc.selfCancel(token);
  }

  /** Devuelve metadata pública del flujo de reserva: brandName, zonas
   *  disponibles, configuración de slots (hardcoded en MVP). 404 si el
   *  módulo está desactivado para el tenant. */
  @Get(':slug')
  @Public()
  async info(@Param('slug') slug: string) {
    const t = await this.prisma.tenant.findUnique({
      where: { slug },
      select: {
        id: true,
        brandName: true,
        status: true,
        reservationsEnabled: true,
        logoUrl: true,
        primaryColor: true,
        // Días habilitados (0=Dom..6=Sáb; vacío=todos) + observaciones que ve
        // el cliente antes de reservar.
        reservationDays: true,
        reservationTerms: true,
        // F3 (2026-07-31): WhatsApp para derivar grupos grandes a atención
        // personalizada. Cascada: reservas → general → teléfono.
        whatsappReservationsPhone: true,
        whatsappPhone: true,
        phone: true,
      },
    });
    if (!t || t.status === 'SUSPENDED' || !t.reservationsEnabled) {
      throw new NotFoundException('Reservas no disponibles');
    }
    // F2 (2026-07-31): la zona lleva locationId para poder filtrar por sede en
    // el flujo público. Se elige la sede primero y luego sus zonas/mesas.
    const zones = await this.prisma.reservationZone.findMany({
      where: { tenantId: t.id, isActive: true },
      orderBy: { position: 'asc' },
      select: { id: true, name: true, slug: true, type: true, locationId: true },
    });
    // F2: sedes activas del negocio. Si hay >1, el público elige a cuál reservar.
    // Reservas por sede (2026-08-01): solo las sedes con reservas habilitadas
    // aparecen en el flujo público (en AND con el toggle maestro del tenant).
    const locations = await this.prisma.location.findMany({
      where: { tenantId: t.id, isActive: true, reservationsEnabled: true },
      orderBy: { createdAt: 'asc' },
      select: { id: true, name: true, address: true },
    });
    // F3: cantidad máxima que entra en la mesa más grande (activa, no bloqueada).
    // Un grupo mayor no cabe en una sola mesa → se deriva a WhatsApp.
    const maxSeatsAgg = await this.prisma.reservationTable.aggregate({
      where: { tenantId: t.id, isActive: true, isBlocked: false },
      _max: { seats: true },
    });
    const maxPartyOnline = maxSeatsAgg._max.seats ?? 0;
    const whatsapp =
      t.whatsappReservationsPhone || t.whatsappPhone || t.phone || null;
    // Slots configurados por el tenant (con fallback al default si no
    // configuró nada). El frontend público los muestra en formato 12h.
    const defaultSlots = await this.svc.getTenantSlots(t.id);
    return {
      brandName: t.brandName,
      logoUrl: t.logoUrl,
      primaryColor: t.primaryColor,
      zones,
      locations,
      maxPartyOnline,
      whatsapp,
      defaultSlots,
      reservationDays: t.reservationDays ?? [],
      reservationTerms: t.reservationTerms ?? null,
    };
  }

  /** Disponibilidad de slots para (date, party, zoneSlug?). Throttle ligero
   *  porque el wizard puede chequear varias veces al cambiar fecha. */
  @Get(':slug/availability')
  @Public()
  async availability(
    @Param('slug') slug: string,
    @Query('date') date: string,
    @Query('party', new DefaultValuePipe(2), ParseIntPipe) party: number,
    @Query('zoneSlug') zoneSlug?: string,
    @Query('locationId') locationId?: string,
  ) {
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw new BadRequestException('date YYYY-MM-DD requerido');
    }
    const t = await this.prisma.tenant.findUnique({
      where: { slug },
      select: { id: true, status: true, reservationsEnabled: true },
    });
    if (!t || t.status === 'SUSPENDED' || !t.reservationsEnabled) {
      throw new NotFoundException('Reservas no disponibles');
    }
    let zoneId: string | null = null;
    if (zoneSlug) {
      const z = await this.prisma.reservationZone.findFirst({
        where: { tenantId: t.id, slug: zoneSlug, isActive: true },
        select: { id: true },
      });
      zoneId = z?.id ?? null;
    }
    // F2: capacidad/disponibilidad scoped a la sede elegida (si vino).
    const slots = await this.svc.getAvailability(
      t.id,
      date,
      party,
      zoneId,
      locationId || null,
    );
    return { date, party, zoneSlug: zoneSlug ?? null, slots };
  }

  /** PDF Software 2026-06-29: mesas de una zona para que el cliente elija cuál
   *  reservar (+ plano visual). Devuelve geometría (posX/posY/shape/seats) y un
   *  flag `taken` si la mesa ya está reservada para ese date+time. */
  @Get(':slug/tables')
  @Public()
  async tables(
    @Param('slug') slug: string,
    @Query('zoneSlug') zoneSlug?: string,
    @Query('date') date?: string,
    @Query('time') time?: string,
    @Query('locationId') locationId?: string,
  ) {
    const t = await this.prisma.tenant.findUnique({
      where: { slug },
      select: { id: true, status: true, reservationsEnabled: true },
    });
    if (!t || t.status === 'SUSPENDED' || !t.reservationsEnabled) {
      throw new NotFoundException('Reservas no disponibles');
    }
    let zoneId: string | null = null;
    if (zoneSlug) {
      const z = await this.prisma.reservationZone.findFirst({
        where: { tenantId: t.id, slug: zoneSlug, isActive: true },
        select: { id: true },
      });
      if (!z) return { zoneSlug, tables: [] };
      zoneId = z.id;
    }
    // F2: si vino locationId (sede elegida) y no una zona, filtramos las mesas
    // de esa sede.
    const tables = await this.prisma.reservationTable.findMany({
      where: {
        tenantId: t.id,
        isActive: true,
        ...(zoneId ? { zoneId } : locationId ? { locationId } : {}),
      },
      orderBy: [{ posY: 'asc' }, { posX: 'asc' }],
      select: {
        id: true,
        number: true,
        seats: true,
        shape: true,
        posX: true,
        posY: true,
        width: true,
        height: true,
        isBlocked: true,
        zoneId: true,
      },
    });
    // Mesas ya tomadas para ese slot (date+time) → se muestran deshabilitadas.
    let takenIds = new Set<string>();
    if (
      date &&
      /^\d{4}-\d{2}-\d{2}$/.test(date) &&
      time &&
      /^([01]\d|2[0-3]):[0-5]\d$/.test(time) &&
      tables.length
    ) {
      const [y, m, d] = date.split('-').map(Number);
      const dateAtNoon = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
      const taken = await this.prisma.reservation.findMany({
        where: {
          tenantId: t.id,
          date: dateAtNoon,
          time,
          tableId: { in: tables.map((x) => x.id) },
          status: { in: ['PENDING', 'CONFIRMED', 'SEATED'] },
        },
        select: { tableId: true },
      });
      takenIds = new Set(
        taken.map((x) => x.tableId).filter((x): x is string => !!x),
      );
    }
    return {
      zoneSlug: zoneSlug ?? null,
      tables: tables.map((x) => ({ ...x, taken: takenIds.has(x.id) })),
    };
  }

  /** Crea reserva pública. Throttle ajustado: 5 por minuto desde la
   *  misma IP es razonable (4 pasos del wizard, retries). */
  @Post(':slug')
  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  async create(@Param('slug') slug: string, @Body() body: PublicReservationBody) {
    const t = await this.prisma.tenant.findUnique({
      where: { slug },
      select: { id: true, status: true, reservationsEnabled: true },
    });
    if (!t || t.status === 'SUSPENDED' || !t.reservationsEnabled) {
      throw new NotFoundException('Reservas no disponibles');
    }
    let zoneId: string | null = null;
    if (body.zoneSlug) {
      const z = await this.prisma.reservationZone.findFirst({
        where: { tenantId: t.id, slug: body.zoneSlug, isActive: true },
        select: { id: true },
      });
      zoneId = z?.id ?? null;
    }
    // Mesa específica elegida (PDF Software 2026-06-29): validamos que sea del
    // tenant y esté activa; derivamos su zona si el cliente no eligió una.
    let tableId: string | null = null;
    if (body.tableId) {
      const tbl = await this.prisma.reservationTable.findFirst({
        where: { id: body.tableId, tenantId: t.id, isActive: true },
        select: { id: true, zoneId: true },
      });
      if (tbl) {
        tableId = tbl.id;
        if (!zoneId) zoneId = tbl.zoneId ?? null;
      }
    }
    const r = await this.svc.createForTenant(
      t.id,
      {
        customerName: body.customerName,
        customerPhone: body.customerPhone,
        customerEmail: body.customerEmail,
        party: body.party,
        date: body.date,
        time: body.time,
        notes: body.notes,
        zoneId,
        tableId,
        // F2: sede elegida. createForTenant igual la deriva de zona/mesa si no
        // viene, pero la pasamos explícita cuando el cliente eligió sede.
        locationId: body.locationId ?? null,
      },
      'WEB',
      { notify: true },
    );
    // Token del pase digital: emite ya aunque la reserva esté PENDING,
    // así el cliente puede ver/guardar su pase desde el confirm step.
    // El pase muestra el estado actual (Pendiente → Confirmada → Sentada).
    const passToken = this.svc.signPassToken(r.id);
    const brand = await this.brand.resolveTenant(t.id);
    const passUrl = `${brand.websiteUrl}/r/pase/${passToken}`;
    return {
      id: r.id,
      status: r.status,
      date: r.date,
      time: r.time,
      party: r.party,
      passUrl,
      passToken,
      message: 'Reserva recibida. El restaurante te contactará para confirmar.',
    };
  }
}
