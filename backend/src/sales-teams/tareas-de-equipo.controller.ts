import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';
import { TareasDeEquipoService } from './tareas-de-equipo.service';
import { ROLES_DE_EQUIPO } from './team-access';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';

/**
 * «Tareas del CRM» del equipo. Controlador propio en `sales-teams/:teamId/tareas/…`:
 * nada del `SalesLeadsController` empieza por `tareas`. `acciones` va antes que
 * `:id` en cada verbo que comparten para que no se lea como un id.
 */

class TareaBody {
  @IsString() leadId!: string;
  @IsString() @MaxLength(40) titulo!: string;
  @IsOptional() @IsString() @MaxLength(4000) descripcion?: string | null;
  @IsOptional() @IsString() @MaxLength(10) fecha?: string | null;
  @IsOptional() @IsString() responsableId?: string | null;
}

class TareaEditBody {
  @IsOptional() @IsString() @MaxLength(40) titulo?: string;
  @IsOptional() @IsString() @MaxLength(4000) descripcion?: string | null;
  @IsOptional() @IsString() @MaxLength(10) fecha?: string | null;
  @IsOptional() @IsString() responsableId?: string | null;
}

class HechaBody {
  @IsBoolean() hecha!: boolean;
}

class AccionBody {
  @IsString() @MaxLength(40) nombre!: string;
}

@Controller('sales-teams/:teamId/tareas')
@Roles(...ROLES_DE_EQUIPO)
export class TareasDeEquipoController {
  constructor(private tareas: TareasDeEquipoService) {}

  @Get()
  listar(
    @CurrentUser() user: AuthUser,
    @Param('teamId') teamId: string,
    @Query('vista') vista?: string,
    @Query('lead') lead?: string,
  ) {
    return this.tareas.listar(user, teamId, { vista, lead });
  }

  @Post()
  crear(@CurrentUser() user: AuthUser, @Param('teamId') teamId: string, @Body() body: TareaBody) {
    return this.tareas.crear(user, teamId, body);
  }

  // ── Catálogo de acciones ──

  @Get('acciones')
  acciones(@CurrentUser() user: AuthUser, @Param('teamId') teamId: string) {
    return this.tareas.listarAcciones(user, teamId);
  }

  @Post('acciones')
  crearAccion(@CurrentUser() user: AuthUser, @Param('teamId') teamId: string, @Body() body: AccionBody) {
    return this.tareas.crearAccion(user, teamId, body);
  }

  @Delete('acciones/:accionId')
  borrarAccion(
    @CurrentUser() user: AuthUser,
    @Param('teamId') teamId: string,
    @Param('accionId') accionId: string,
  ) {
    return this.tareas.borrarAccion(user, teamId, accionId);
  }

  // ── Una tarea ──

  @Patch(':id')
  editar(
    @CurrentUser() user: AuthUser,
    @Param('teamId') teamId: string,
    @Param('id') id: string,
    @Body() body: TareaEditBody,
  ) {
    return this.tareas.editar(user, teamId, id, body);
  }

  @Patch(':id/hecha')
  marcar(
    @CurrentUser() user: AuthUser,
    @Param('teamId') teamId: string,
    @Param('id') id: string,
    @Body() body: HechaBody,
  ) {
    return this.tareas.marcar(user, teamId, id, body);
  }

  @Delete(':id')
  borrar(@CurrentUser() user: AuthUser, @Param('teamId') teamId: string, @Param('id') id: string) {
    return this.tareas.borrar(user, teamId, id);
  }
}
