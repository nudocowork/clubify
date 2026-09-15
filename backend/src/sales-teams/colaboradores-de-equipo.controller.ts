import { ROLES_DE_EQUIPO } from './team-access';
import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ArrayMaxSize, IsArray, IsOptional, IsString } from 'class-validator';
import { ColaboradoresDeEquipoService } from './colaboradores-de-equipo.service';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';

/**
 * «Colaboradores» del equipo. Controlador propio en
 * `sales-teams/:teamId/colaboradores/…`: el `SalesLeadsController` cuelga de
 * `sales-teams/:teamId` y no tiene rutas que empiecen por `colaboradores`.
 */

class AgregarBody {
  @IsString() userId!: string;
  /** lider · closer · setter · lectura. La lista válida la limpia el servicio. */
  @IsOptional() @IsArray() @ArrayMaxSize(4) @IsString({ each: true }) roles?: string[];
}

class RolesBody {
  @IsArray() @ArrayMaxSize(4) @IsString({ each: true }) roles!: string[];
}

@Controller('sales-teams/:teamId/colaboradores')
@Roles(...ROLES_DE_EQUIPO)
export class ColaboradoresDeEquipoController {
  constructor(private colaboradores: ColaboradoresDeEquipoService) {}

  @Get()
  listar(@CurrentUser() user: AuthUser, @Param('teamId') teamId: string) {
    return this.colaboradores.listar(user, teamId);
  }

  @Get('candidatos')
  candidatos(@CurrentUser() user: AuthUser, @Param('teamId') teamId: string) {
    return this.colaboradores.candidatos(user, teamId);
  }

  @Post()
  agregar(@CurrentUser() user: AuthUser, @Param('teamId') teamId: string, @Body() body: AgregarBody) {
    return this.colaboradores.agregar(user, teamId, body);
  }

  @Patch(':userId')
  cambiarRoles(
    @CurrentUser() user: AuthUser,
    @Param('teamId') teamId: string,
    @Param('userId') userId: string,
    @Body() body: RolesBody,
  ) {
    return this.colaboradores.cambiarRoles(user, teamId, userId, body);
  }

  @Delete(':userId')
  quitar(@CurrentUser() user: AuthUser, @Param('teamId') teamId: string, @Param('userId') userId: string) {
    return this.colaboradores.quitar(user, teamId, userId);
  }
}
