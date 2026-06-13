import { Body, Controller, Get, NotFoundException, Param, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { IsEmail, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';
import { ReservationsService } from './reservations.service';
import { Public } from '../common/decorators/public.decorator';
import { PrismaService } from '../common/prisma/prisma.service';

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
  ) {}

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
    return {
      brandName: t.brandName,
      logoUrl: t.logoUrl,
      primaryColor: t.primaryColor,
      zones,
      // Slots por defecto. En una iteración futura se calcula contra
      // las reservas existentes para esa fecha + capacidad de mesas.
      defaultSlots: ['13:00', '13:30', '14:00', '14:30', '21:00', '21:30', '22:00'],
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
    return {
      id: r.id,
      status: r.status,
      date: r.date,
      time: r.time,
      party: r.party,
      message: 'Reserva recibida. El restaurante te contactará para confirmar.',
    };
  }
}
