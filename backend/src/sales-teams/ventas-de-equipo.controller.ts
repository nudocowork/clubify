import { Body, Controller, Delete, Get, Param, Patch, Put, Query } from '@nestjs/common';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { VentasDeEquipoService } from './ventas-de-equipo.service';
import { ROLES_DE_EQUIPO } from './team-access';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';

/**
 * «Venta del equipo», en `sales-teams/:teamId/ventas`: el negocio de la marca en
 * que se convirtió un lead ganado, con su closer y su setter. No paga nada.
 */

class VincularBody {
  @IsString() @MaxLength(64) negocioId!: string;
  @IsOptional() @IsString() @MaxLength(64) closerUserId?: string | null;
  @IsOptional() @IsString() @MaxLength(64) setterUserId?: string | null;
}

class PersonasBody {
  /** Sin la clave = no se toca; null = sin closer. */
  @IsOptional() @IsString() @MaxLength(64) closerUserId?: string | null;
  @IsOptional() @IsString() @MaxLength(64) setterUserId?: string | null;
}

@Controller('sales-teams/:teamId/ventas')
@Roles(...ROLES_DE_EQUIPO)
export class VentasDeEquipoController {
  constructor(private ventas: VentasDeEquipoService) {}

  @Get()
  listar(@CurrentUser() user: AuthUser, @Param('teamId') teamId: string) {
    return this.ventas.listar(user, teamId);
  }

  @Get('negocios')
  buscarNegocios(@CurrentUser() user: AuthUser, @Param('teamId') teamId: string, @Query('q') q?: string) {
    return this.ventas.buscarNegocios(user, teamId, q);
  }

  @Get('leads/:leadId')
  preparar(@CurrentUser() user: AuthUser, @Param('teamId') teamId: string, @Param('leadId') leadId: string) {
    return this.ventas.preparar(user, teamId, leadId);
  }

  @Put('leads/:leadId')
  vincular(
    @CurrentUser() user: AuthUser,
    @Param('teamId') teamId: string,
    @Param('leadId') leadId: string,
    @Body() body: VincularBody,
  ) {
    return this.ventas.vincular(user, teamId, leadId, body);
  }

  @Patch('leads/:leadId')
  cambiarPersonas(
    @CurrentUser() user: AuthUser,
    @Param('teamId') teamId: string,
    @Param('leadId') leadId: string,
    @Body() body: PersonasBody,
  ) {
    return this.ventas.cambiarPersonas(user, teamId, leadId, body);
  }

  @Delete('leads/:leadId')
  desvincular(@CurrentUser() user: AuthUser, @Param('teamId') teamId: string, @Param('leadId') leadId: string) {
    return this.ventas.desvincular(user, teamId, leadId);
  }
}
