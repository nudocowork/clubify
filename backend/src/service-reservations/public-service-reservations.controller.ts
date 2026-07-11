import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { Public } from '../common/decorators/public.decorator';
import { ServiceReservationsService } from './service-reservations.service';

class PublicBookBody {
  @IsString() serviceId!: string;
  @IsString() startAt!: string; // ISO UTC (de un slot devuelto por /slots)
  @IsString() @MaxLength(120) customerName!: string;
  @IsString() @MaxLength(40) customerPhone!: string;
  @IsOptional() @IsString() @MaxLength(40) providerId?: string | null;
  @IsOptional() @IsString() @MaxLength(500) notes?: string;
}
class RescheduleBody {
  @IsString() startAt!: string; // ISO UTC del nuevo slot
}

/**
 * Reserva PÚBLICA de servicios (Fase 3 PDF245 P7). Sin auth. La página
 * `/cita/[slug]` la consume. 404 si el negocio no tiene el módulo activo.
 */
@Controller('public/service-reservations')
export class PublicServiceReservationsController {
  constructor(private svc: ServiceReservationsService) {}

  @Public()
  @Get(':slug')
  info(@Param('slug') slug: string) {
    return this.svc.publicInfo(slug);
  }

  @Public()
  @Get(':slug/slots')
  slots(
    @Param('slug') slug: string,
    @Query('serviceId') serviceId: string,
    @Query('date') date: string,
    @Query('providerId') providerId?: string,
  ) {
    return this.svc.publicSlots(slug, serviceId, date, providerId);
  }

  @Public()
  @Post(':slug/book')
  book(@Param('slug') slug: string, @Body() body: PublicBookBody) {
    return this.svc.publicBook(slug, body);
  }

  // ─── Gestión por el cliente (token) — Fase 5 ───
  @Public()
  @Get('manage/:token')
  getByToken(@Param('token') token: string) {
    return this.svc.getByToken(token);
  }

  @Public()
  @Post('manage/:token/cancel')
  cancel(@Param('token') token: string) {
    return this.svc.cancelByToken(token);
  }

  @Public()
  @Post('manage/:token/reschedule')
  reschedule(@Param('token') token: string, @Body() body: RescheduleBody) {
    return this.svc.rescheduleByToken(token, body.startAt);
  }
}
