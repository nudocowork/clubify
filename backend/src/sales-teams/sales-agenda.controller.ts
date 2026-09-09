import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  IsArray,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { SalesAgendaService } from './sales-agenda.service';
import { Roles } from '../common/decorators/roles.decorator';
import { Public } from '../common/decorators/public.decorator';
import {
  CurrentUser,
  AuthUser,
} from '../common/decorators/current-user.decorator';

class FranjaDto {
  @IsInt() @Min(0) @Max(6) weekday!: number;
  @IsInt() @Min(0) @Max(1440) startMin!: number;
  @IsInt() @Min(0) @Max(1440) endMin!: number;
}

class HorarioBody {
  /** null = el horario del EQUIPO, que vale para quien no tenga el suyo. */
  @IsOptional() @IsString() userId?: string | null;
  @IsArray() @ValidateNested({ each: true }) @Type(() => FranjaDto)
  franjas!: FranjaDto[];
}

class CitaBody {
  @IsOptional() @IsString() leadId?: string | null;
  @IsOptional() @IsString() hostUserId?: string | null;
  @IsISO8601() startAt!: string;
  @IsOptional() @IsInt() @Min(5) @Max(480) durationMin?: number;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string | null;
}

class EstadoBody {
  @IsIn(['PENDIENTE', 'CONFIRMADA', 'REALIZADA', 'NO_ASISTIO', 'CANCELADA'])
  status!: string;
}

class ReservaPublicaBody {
  @IsISO8601() startAt!: string;
  @IsOptional() @IsString() hostUserId?: string | null;
  @IsOptional() @IsString() @MaxLength(120) name?: string | null;
  @IsOptional() @IsString() @MaxLength(40) phone?: string | null;
  @IsOptional() @IsString() @MaxLength(160) email?: string | null;
  @IsOptional() @IsString() @MaxLength(500) notes?: string | null;
}

/** La agenda vista desde dentro: el vendedor y quien manda en la marca. */
@Controller('sales-teams/:teamId/agenda')
@Roles('PLATFORM_OWNER', 'SUPER_ADMIN', 'TENANT_OWNER', 'TENANT_STAFF')
export class SalesAgendaController {
  constructor(private svc: SalesAgendaService) {}

  @Get('horario')
  verHorario(@CurrentUser() user: AuthUser, @Param('teamId') teamId: string) {
    return this.svc.verHorario(user, teamId);
  }

  @Post('enlace')
  asegurarEnlace(
    @CurrentUser() user: AuthUser,
    @Param('teamId') teamId: string,
  ) {
    return this.svc.asegurarEnlace(user, teamId);
  }

  @Post('horario')
  guardarHorario(
    @CurrentUser() user: AuthUser,
    @Param('teamId') teamId: string,
    @Body() body: HorarioBody,
  ) {
    return this.svc.guardarHorario(user, teamId, body);
  }

  @Get('huecos')
  huecos(
    @CurrentUser() user: AuthUser,
    @Param('teamId') teamId: string,
    @Query('fecha') fecha: string,
    @Query('hostUserId') hostUserId?: string,
    @Query('duracionMin') duracionMin?: string,
  ) {
    return this.svc.huecos(user, teamId, {
      fecha,
      hostUserId: hostUserId || null,
      duracionMin: duracionMin ? Number(duracionMin) : undefined,
    });
  }

  @Get('citas')
  listar(
    @CurrentUser() user: AuthUser,
    @Param('teamId') teamId: string,
    @Query('desde') desde?: string,
    @Query('hasta') hasta?: string,
    @Query('hostUserId') hostUserId?: string,
  ) {
    return this.svc.listar(user, teamId, {
      desde,
      hasta,
      hostUserId: hostUserId || null,
    });
  }

  @Post('citas')
  agendar(
    @CurrentUser() user: AuthUser,
    @Param('teamId') teamId: string,
    @Body() body: CitaBody,
  ) {
    return this.svc.agendar(user, teamId, body);
  }

  @Patch('citas/:citaId')
  cambiarEstado(
    @CurrentUser() user: AuthUser,
    @Param('teamId') teamId: string,
    @Param('citaId') citaId: string,
    @Body() body: EstadoBody,
  ) {
    return this.svc.cambiarEstado(user, teamId, citaId, body.status);
  }
}

/**
 * La agenda vista desde fuera: el prospecto, sin cuenta de nada.
 *
 * Se entra por el `slug` del equipo para reservar, y por el `manageToken` de la
 * cita para verla o cancelarla. **El id de la cita no aparece en ninguna URL
 * pública**: con el id, cambiar un número cancelaría la cita de otro.
 *
 * Las tres rutas comprueban que la marca tenga el módulo encendido. Sin eso,
 * apagarlo escondería el menú y dejaría este enlace sirviendo citas.
 */
@Controller('public/agenda')
export class PublicSalesAgendaController {
  constructor(private svc: SalesAgendaService) {}

  @Public()
  @Get(':teamSlug')
  calendario(
    @Param('teamSlug') teamSlug: string,
    @Query('hostUserId') hostUserId?: string,
  ) {
    return this.svc.calendarioPublico(teamSlug, hostUserId || null);
  }

  @Public()
  @Post(':teamSlug/reservar')
  reservar(
    @Param('teamSlug') teamSlug: string,
    @Body() body: ReservaPublicaBody,
  ) {
    return this.svc.reservarPublico(teamSlug, body);
  }

  @Public()
  @Get('cita/:token')
  verCita(@Param('token') token: string) {
    return this.svc.verPorToken(token);
  }

  @Public()
  @Post('cita/:token/cancelar')
  cancelar(@Param('token') token: string) {
    return this.svc.cancelarPorToken(token);
  }
}
