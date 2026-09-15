import { ROLES_DE_EQUIPO } from './team-access';
import { Body, Controller, Get, Param, Patch } from '@nestjs/common';
import { IsBoolean, IsIn, IsString, MaxLength } from 'class-validator';
import { BancoDeEquipoService } from './banco-de-equipo.service';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';

/**
 * El Banco del equipo de ventas: la cola de citas por asignar y por confirmar.
 *
 * Controlador propio y no más rutas en `SalesLeadsController`: el banco trabaja
 * sobre CITAS, no sobre leads, y mezclarlos es como acabó la pestaña enseñando
 * leads. Los roles del decorador son la primera puerta; la que de verdad aísla
 * entre marcas es `resolveTeamAccess`, dentro de cada método del servicio.
 */

class AsignarBody {
  @IsString() @MaxLength(60) hostUserId!: string;
}

class OnBody {
  @IsBoolean() on!: boolean;
}

class ConfirmacionBody {
  @IsIn(['1h', '30min']) cual!: '1h' | '30min';
  @IsBoolean() on!: boolean;
}

@Controller('sales-teams/:teamId/banco')
@Roles(...ROLES_DE_EQUIPO)
export class BancoDeEquipoController {
  constructor(private banco: BancoDeEquipoService) {}

  @Get()
  ver(@CurrentUser() user: AuthUser, @Param('teamId') teamId: string) {
    return this.banco.banco(user, teamId);
  }

  @Patch('citas/:citaId/asignar')
  asignar(
    @CurrentUser() user: AuthUser,
    @Param('teamId') teamId: string,
    @Param('citaId') citaId: string,
    @Body() body: AsignarBody,
  ) {
    return this.banco.asignar(user, teamId, citaId, body.hostUserId);
  }

  @Patch('citas/:citaId/confirmar')
  confirmar(
    @CurrentUser() user: AuthUser,
    @Param('teamId') teamId: string,
    @Param('citaId') citaId: string,
    @Body() body: OnBody,
  ) {
    return this.banco.confirmar(user, teamId, citaId, body.on);
  }

  @Patch('citas/:citaId/confirmacion')
  confirmacion(
    @CurrentUser() user: AuthUser,
    @Param('teamId') teamId: string,
    @Param('citaId') citaId: string,
    @Body() body: ConfirmacionBody,
  ) {
    return this.banco.marcarConfirmacion(user, teamId, citaId, body.cual, body.on);
  }

  @Patch('citas/:citaId/no-asistio')
  noAsistio(
    @CurrentUser() user: AuthUser,
    @Param('teamId') teamId: string,
    @Param('citaId') citaId: string,
  ) {
    return this.banco.noAsistio(user, teamId, citaId);
  }

  @Patch('citas/:citaId/cancelar')
  cancelar(
    @CurrentUser() user: AuthUser,
    @Param('teamId') teamId: string,
    @Param('citaId') citaId: string,
  ) {
    return this.banco.cancelar(user, teamId, citaId);
  }
}
