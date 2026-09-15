import { ROLES_DE_EQUIPO } from './team-access';
import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { CrmDeEquipoService } from './crm-de-equipo.service';
import { ESTADOS_DE_OPORTUNIDAD } from './crm-de-equipo';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';

/**
 * «CRM» del equipo: embudos de oportunidades.
 *
 * Controlador propio en `sales-teams/:teamId/crm/…`. El `SalesLeadsController`
 * cuelga de `sales-teams/:teamId` y no tiene ninguna ruta que empiece por `crm`,
 * así que nada captura estas. Quién puede y con qué permisos lo decide el
 * servicio.
 */

class NombreBody {
  @IsString() @MaxLength(60) nombre!: string;
}

class EtapaBody {
  @IsString() @MaxLength(40) nombre!: string;
  @IsOptional() @IsString() @MaxLength(9) color?: string | null;
}

class EtapaEditBody {
  @IsOptional() @IsString() @MaxLength(40) nombre?: string;
  @IsOptional() @IsString() @MaxLength(9) color?: string | null;
}

class OrdenBody {
  @IsArray() @ArrayMaxSize(100) @IsString({ each: true }) ids!: string[];
}

class OportunidadBody {
  @IsString() embudoId!: string;
  @IsString() etapaId!: string;
  @IsOptional() @IsString() @MaxLength(120) nombre?: string;
  @IsOptional() @IsNumber() @Min(0) valor?: number | null;
  @IsOptional() @IsString() responsableId?: string | null;
  @IsOptional() @IsString() leadId?: string;
  @IsOptional() @IsString() @MaxLength(120) contactoNombre?: string;
  @IsOptional() @IsString() @MaxLength(40) contactoTelefono?: string;
}

class OportunidadEditBody {
  @IsOptional() @IsString() @MaxLength(120) nombre?: string;
  @IsOptional() @IsNumber() @Min(0) valor?: number | null;
  @IsOptional() @IsString() responsableId?: string | null;
}

class MoverBody {
  @IsString() etapaId!: string;
  /** Antes de qué tarjeta se soltó. Manda sobre `posicion`; sin ninguno, al final. */
  @IsOptional() @IsString() antesDeId?: string | null;
  @IsOptional() @IsInt() @Min(0) posicion?: number;
  /** La etapa en la que la persona CREÍA que estaba, para no pisar a otra. */
  @IsOptional() @IsString() etapaActualId?: string | null;
}

class EstadoBody {
  @IsIn(ESTADOS_DE_OPORTUNIDAD as unknown as string[]) estado!: string;
  @IsOptional() @IsString() @MaxLength(200) motivo?: string | null;
}

@Controller('sales-teams/:teamId/crm')
@Roles(...ROLES_DE_EQUIPO)
export class CrmDeEquipoController {
  constructor(private crm: CrmDeEquipoService) {}

  @Get()
  tablero(
    @CurrentUser() user: AuthUser,
    @Param('teamId') teamId: string,
    @Query('embudo') embudo?: string,
    @Query('responsable') responsable?: string,
    @Query('estado') estado?: string,
    @Query('q') q?: string,
  ) {
    return this.crm.tablero(user, teamId, { embudo, responsable, estado, q });
  }

  // ── Embudos y etapas ──

  @Post('embudos')
  crearEmbudo(@CurrentUser() user: AuthUser, @Param('teamId') teamId: string, @Body() body: NombreBody) {
    return this.crm.crearEmbudo(user, teamId, body);
  }

  @Patch('embudos/:embudoId')
  renombrarEmbudo(
    @CurrentUser() user: AuthUser,
    @Param('teamId') teamId: string,
    @Param('embudoId') embudoId: string,
    @Body() body: NombreBody,
  ) {
    return this.crm.renombrarEmbudo(user, teamId, embudoId, body);
  }

  @Delete('embudos/:embudoId')
  borrarEmbudo(
    @CurrentUser() user: AuthUser,
    @Param('teamId') teamId: string,
    @Param('embudoId') embudoId: string,
  ) {
    return this.crm.borrarEmbudo(user, teamId, embudoId);
  }

  @Post('embudos/:embudoId/etapas')
  crearEtapa(
    @CurrentUser() user: AuthUser,
    @Param('teamId') teamId: string,
    @Param('embudoId') embudoId: string,
    @Body() body: EtapaBody,
  ) {
    return this.crm.crearEtapa(user, teamId, embudoId, body);
  }

  @Patch('embudos/:embudoId/etapas/orden')
  ordenarEtapas(
    @CurrentUser() user: AuthUser,
    @Param('teamId') teamId: string,
    @Param('embudoId') embudoId: string,
    @Body() body: OrdenBody,
  ) {
    return this.crm.ordenarEtapas(user, teamId, embudoId, body);
  }

  @Patch('etapas/:etapaId')
  editarEtapa(
    @CurrentUser() user: AuthUser,
    @Param('teamId') teamId: string,
    @Param('etapaId') etapaId: string,
    @Body() body: EtapaEditBody,
  ) {
    return this.crm.editarEtapa(user, teamId, etapaId, body);
  }

  @Delete('etapas/:etapaId')
  borrarEtapa(
    @CurrentUser() user: AuthUser,
    @Param('teamId') teamId: string,
    @Param('etapaId') etapaId: string,
  ) {
    return this.crm.borrarEtapa(user, teamId, etapaId);
  }

  // ── Oportunidades ──

  @Post('oportunidades')
  crearOportunidad(
    @CurrentUser() user: AuthUser,
    @Param('teamId') teamId: string,
    @Body() body: OportunidadBody,
  ) {
    return this.crm.crearOportunidad(user, teamId, body);
  }

  @Patch('oportunidades/:id')
  editarOportunidad(
    @CurrentUser() user: AuthUser,
    @Param('teamId') teamId: string,
    @Param('id') id: string,
    @Body() body: OportunidadEditBody,
  ) {
    return this.crm.editarOportunidad(user, teamId, id, body);
  }

  @Patch('oportunidades/:id/mover')
  moverOportunidad(
    @CurrentUser() user: AuthUser,
    @Param('teamId') teamId: string,
    @Param('id') id: string,
    @Body() body: MoverBody,
  ) {
    return this.crm.moverOportunidad(user, teamId, id, body);
  }

  @Patch('oportunidades/:id/estado')
  cambiarEstado(
    @CurrentUser() user: AuthUser,
    @Param('teamId') teamId: string,
    @Param('id') id: string,
    @Body() body: EstadoBody,
  ) {
    return this.crm.cambiarEstado(user, teamId, id, body);
  }

  @Delete('oportunidades/:id')
  borrarOportunidad(
    @CurrentUser() user: AuthUser,
    @Param('teamId') teamId: string,
    @Param('id') id: string,
  ) {
    return this.crm.borrarOportunidad(user, teamId, id);
  }
}
