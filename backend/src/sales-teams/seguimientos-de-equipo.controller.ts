import { ROLES_DE_EQUIPO } from './team-access';
import { Body, Controller, Delete, Get, Param, Patch, Query } from '@nestjs/common';
import { IsIn, IsISO8601, IsOptional, IsString, MaxLength } from 'class-validator';
import { SeguimientosDeEquipoService } from './seguimientos-de-equipo.service';
import { RESULTADOS } from './seguimientos-de-equipo';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';

/**
 * «Seguimientos» del equipo: la lista por grupos y el cierre de cada paso.
 *
 * Controlador propio en `sales-teams/:teamId/seguimientos/…`. La lista va en
 * `agrupados` para no chocar con el `GET sales-teams/:teamId/seguimientos` que
 * ya existía (la lista plana, que otras pantallas pueden seguir usando).
 */

class ResultadoBody {
  @IsIn(RESULTADOS as unknown as string[]) outcome!: string;
  @IsOptional() @IsISO8601() proximaFecha?: string | null;
  @IsOptional() @IsString() @MaxLength(2000) nota?: string | null;
  @IsOptional() @IsString() @MaxLength(200) motivo?: string | null;
}

@Controller('sales-teams/:teamId/seguimientos')
@Roles(...ROLES_DE_EQUIPO)
export class SeguimientosDeEquipoController {
  constructor(private seguimientos: SeguimientosDeEquipoService) {}

  @Get('agrupados')
  listar(
    @CurrentUser() user: AuthUser,
    @Param('teamId') teamId: string,
    @Query('estado') estado?: string,
  ) {
    return this.seguimientos.listar(user, teamId, estado === 'hechos' ? 'hechos' : 'pendientes');
  }

  @Patch(':seguimientoId/resultado')
  resultado(
    @CurrentUser() user: AuthUser,
    @Param('teamId') teamId: string,
    @Param('seguimientoId') seguimientoId: string,
    @Body() body: ResultadoBody,
  ) {
    return this.seguimientos.registrarResultado(user, teamId, seguimientoId, body);
  }

  @Delete(':seguimientoId')
  eliminar(
    @CurrentUser() user: AuthUser,
    @Param('teamId') teamId: string,
    @Param('seguimientoId') seguimientoId: string,
  ) {
    return this.seguimientos.eliminar(user, teamId, seguimientoId);
  }
}
