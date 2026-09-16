import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import {
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { AgendasDeReservaService } from './agendas-de-reserva.service';
import { ROLES_DE_EQUIPO } from './team-access';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';

/**
 * «Agendas de reserva del equipo». Controlador propio en
 * `sales-teams/:teamId/agendas`, aparte de `…/agenda` (la cuadrícula y las
 * citas): esto configura los enlaces públicos, no la agenda del día. Los valores
 * permitidos los comprueba el servicio.
 */

class NuevaAgendaBody {
  @IsString() @MaxLength(80) nombre!: string;
  /** Vacío = sale del nombre. */
  @IsOptional() @IsString() @MaxLength(80) slug?: string | null;
}

class FranjaBody {
  @IsInt() @Min(0) @Max(6) weekday!: number;
  @IsInt() @Min(0) @Max(1440) startMin!: number;
  @IsInt() @Min(0) @Max(1440) endMin!: number;
}

class EditarAgendaBody {
  @IsOptional() @IsString() @MaxLength(80) nombre?: string;
  @IsOptional() @IsString() @MaxLength(80) slug?: string;
  @IsOptional() @IsString() @MaxLength(7) color?: string | null;
  @IsOptional() @IsBoolean() activa?: boolean;
  @IsOptional() @IsString() @MaxLength(60) formularioId?: string | null;
  @IsOptional() @IsString() @MaxLength(80) titulo?: string | null;
  @IsOptional() @IsString() @MaxLength(200) subtitulo?: string | null;
  @IsOptional() @IsInt() duracionMin?: number;
  @IsOptional() @IsInt() diasHaciaAdelante?: number;
  @IsOptional() @IsInt() antelacionMin?: number;
  @IsOptional() @IsArray() @IsString({ each: true }) fechasBloqueadas?: string[];
  @IsOptional() @IsString() @MaxLength(300) volverAlSitio?: string | null;
  @IsOptional() @IsInt() redirigirEnSegundos?: number;
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => FranjaBody) franjas?: FranjaBody[];
  @IsOptional() @IsInt() pasoMin?: number;
  @IsOptional() @IsInt() cuposPorHorario?: number;
}

@Controller('sales-teams/:teamId/agendas')
@Roles(...ROLES_DE_EQUIPO)
export class AgendasDeReservaController {
  constructor(private agendas: AgendasDeReservaService) {}

  @Get()
  listar(@CurrentUser() user: AuthUser, @Param('teamId') teamId: string) {
    return this.agendas.listar(user, teamId);
  }

  @Post()
  crear(@CurrentUser() user: AuthUser, @Param('teamId') teamId: string, @Body() body: NuevaAgendaBody) {
    return this.agendas.crear(user, teamId, body);
  }

  @Patch(':agendaId')
  editar(
    @CurrentUser() user: AuthUser,
    @Param('teamId') teamId: string,
    @Param('agendaId') agendaId: string,
    @Body() body: EditarAgendaBody,
  ) {
    return this.agendas.editar(user, teamId, agendaId, body);
  }

  @Delete(':agendaId')
  borrar(@CurrentUser() user: AuthUser, @Param('teamId') teamId: string, @Param('agendaId') agendaId: string) {
    return this.agendas.borrar(user, teamId, agendaId);
  }
}
