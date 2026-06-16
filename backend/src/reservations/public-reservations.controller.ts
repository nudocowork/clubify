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
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { IsEmail, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';
import { ReservationsService } from './reservations.service';
import { Public } from '../common/decorators/public.decorator';
import { PrismaService } from '../common/prisma/prisma.service';
import { GoogleWalletService } from '../wallet/google-wallet.service';

class PublicReservationBody {
  @IsString() @MaxLength(120) customerName!: string;
  @IsString() @MaxLength(40) customerPhone!: string;
  @IsOptional() @IsEmail() customerEmail?: string;
  @IsInt() @Min(1) @Max(20) party!: number;
  @Matches(/^\d{4}-\d{2}-\d{2}$/) date!: string;
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/) time!: string;
  @IsOptional() @IsString() @MaxLength(500) notes?: string;
  @IsOptional() @IsString() zoneSlug?: string;
}

@Controller('public/reservations')
export class PublicReservationsController {
  constructor(
    private svc: ReservationsService,
    private prisma: PrismaService,
    private googleWallet: GoogleWalletService,
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
      },
    });
    if (!t || t.status === 'SUSPENDED' || !t.reservationsEnabled) {
      throw new NotFoundException('Reservas no disponibles');
    }
    const zones = await this.prisma.reservationZone.findMany({
      where: { tenantId: t.id, isActive: true },
      orderBy: { position: 'asc' },
      select: { id: true, name: true, slug: true, type: true },
    });
    // Slots configurados por el tenant (con fallback al default si no
    // configuró nada). El frontend público los muestra en formato 12h.
    const defaultSlots = await this.svc.getTenantSlots(t.id);
    return {
      brandName: t.brandName,
      logoUrl: t.logoUrl,
      primaryColor: t.primaryColor,
      zones,
      defaultSlots,
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
    const slots = await this.svc.getAvailability(t.id, date, party, zoneId);
    return { date, party, zoneSlug: zoneSlug ?? null, slots };
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
      },
      'WEB',
      { notify: true },
    );
    // Token del pase digital: emite ya aunque la reserva esté PENDING,
    // así el cliente puede ver/guardar su pase desde el confirm step.
    // El pase muestra el estado actual (Pendiente → Confirmada → Sentada).
    const passToken = this.svc.signPassToken(r.id);
    const passUrl = `https://soyclubify.com/r/pase/${passToken}`;
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
