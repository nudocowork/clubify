import { Body, Controller, Delete, Get, Param, Patch, Post, Put } from '@nestjs/common';
import { IsArray, IsBoolean, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { FormulariosDeEquipoService } from './formularios-de-equipo.service';
import { ROLES_DE_EQUIPO } from './team-access';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';

/**
 * «Formularios» del equipo. Controlador propio en `sales-teams/:teamId/formularios/…`:
 * nada del `SalesLeadsController` empieza por `formularios`. `agenda` es de un
 * solo segmento y va con PUT, así que no choca con `PATCH :id`.
 */

class FormularioBody {
  @IsString() @MaxLength(120) nombre!: string;
  /** `agenda` = empezar con las preguntas de agendamiento de la referencia. */
  @IsOptional() @IsIn(['agenda', 'vacio']) plantilla?: string;
}

class FormularioEditBody {
  @IsOptional() @IsString() @MaxLength(120) nombre?: string;
  @IsOptional() @IsString() @MaxLength(500) descripcion?: string | null;
  /** Las preguntas: las limpia y valida el servicio (`normalizarCampos`). */
  @IsOptional() @IsArray() campos?: unknown[];
  @IsOptional() @IsBoolean() activo?: boolean;
  @IsOptional() @IsString() @MaxLength(30) redirectWhatsapp?: string | null;
  @IsOptional() @IsString() @MaxLength(500) redirectMessage?: string | null;
}

class AgendaBody {
  @IsOptional() @IsString() formularioId?: string | null;
}

@Controller('sales-teams/:teamId/formularios')
@Roles(...ROLES_DE_EQUIPO)
export class FormulariosDeEquipoController {
  constructor(private formularios: FormulariosDeEquipoService) {}

  @Get()
  listar(@CurrentUser() user: AuthUser, @Param('teamId') teamId: string) {
    return this.formularios.listar(user, teamId);
  }

  @Post()
  crear(@CurrentUser() user: AuthUser, @Param('teamId') teamId: string, @Body() body: FormularioBody) {
    return this.formularios.crear(user, teamId, body);
  }

  @Put('agenda')
  usarEnAgenda(@CurrentUser() user: AuthUser, @Param('teamId') teamId: string, @Body() body: AgendaBody) {
    return this.formularios.usarEnAgenda(user, teamId, body);
  }

  @Patch(':id')
  editar(
    @CurrentUser() user: AuthUser,
    @Param('teamId') teamId: string,
    @Param('id') id: string,
    @Body() body: FormularioEditBody,
  ) {
    return this.formularios.editar(user, teamId, id, body);
  }

  @Delete(':id')
  borrar(@CurrentUser() user: AuthUser, @Param('teamId') teamId: string, @Param('id') id: string) {
    return this.formularios.borrar(user, teamId, id);
  }
}
