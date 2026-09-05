import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  IsEmail,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { EventsService } from './events.service';
import { Public } from '../common/decorators/public.decorator';

class ReservarBody {
  @IsString() @MaxLength(120) customerName!: string;
  @IsString() @MaxLength(40) customerPhone!: string;
  @IsOptional() @IsEmail() customerEmail?: string;
  @IsInt() @Min(1) @Max(20) party!: number;
  @IsOptional() @IsString() @MaxLength(300) notes?: string;
}

/**
 * El enlace del evento, para el cliente final.
 *
 * Sin login: el enlace ES la invitación, igual que el de una tarjeta. El
 * negocio lo comparte por WhatsApp o lo imprime como QR, y quien lo abre puede
 * apartar su cupo sin pasar por el mostrador.
 *
 * El límite de peticiones es más apretado que en el panel a propósito: esto se
 * publica en grupos, y un evento con treinta cupos no necesita más de unas
 * pocas reservas por minuto desde la misma línea.
 */
@Controller('public/events')
export class PublicEventsController {
  constructor(private svc: EventsService) {}

  @Get(':eventId')
  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 60 } })
  ver(@Param('eventId') eventId: string) {
    return this.svc.eventoPublico(eventId);
  }

  @Post(':eventId/reservar')
  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  async reservar(
    @Param('eventId') eventId: string,
    @Body() body: ReservarBody,
  ) {
    const r = await this.svc.reservarPublico(eventId, body);
    // Se devuelve lo justo para pintar la confirmación. Ni la lista de
    // asistentes ni el id interno del cliente salen de aquí.
    return {
      ok: true,
      yaEstabas: r.yaEstaba,
      reservaId: r.attendee.id,
      nombre: r.attendee.customerName,
      personas: r.attendee.party,
    };
  }
}
