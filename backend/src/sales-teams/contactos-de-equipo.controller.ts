import { ROLES_DE_EQUIPO } from './team-access';
import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import {
  ArrayMaxSize,
  IsArray,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { ContactosDeEquipoService } from './contactos-de-equipo.service';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';

/**
 * «Contactos» del equipo de ventas: la base filtrable y las acciones en lote.
 *
 * Controlador propio en `sales-teams/:teamId/contactos`. Los roles del
 * decorador son la primera puerta; la que aísla entre marcas y equipos es
 * `resolveTeamAccess`, dentro de cada método del servicio.
 */

class IdsBody {
  @IsArray() @ArrayMaxSize(5000) @IsString({ each: true }) ids!: string[];
}

class EtiquetarBody extends IdsBody {
  @IsString() @MaxLength(60) etiqueta!: string;
}

class InscribirBody extends IdsBody {
  @IsString() @MaxLength(60) flujoId!: string;
}

class VistaBody {
  @IsString() @MaxLength(60) nombre!: string;
  @IsOptional() @IsObject() filtros?: Record<string, unknown>;
}

@Controller('sales-teams/:teamId/contactos')
@Roles(...ROLES_DE_EQUIPO)
export class ContactosDeEquipoController {
  constructor(private contactos: ContactosDeEquipoService) {}

  @Get()
  listar(
    @CurrentUser() user: AuthUser,
    @Param('teamId') teamId: string,
    @Query('q') q?: string,
    @Query('etiqueta') etiqueta?: string,
    @Query('columna') columna?: string,
    @Query('origen') origen?: string,
    @Query('pagina') pagina?: string,
  ) {
    return this.contactos.listar(user, teamId, { q, etiqueta, columna, origen, pagina: Number(pagina) || 1 });
  }

  @Get('ids')
  ids(
    @CurrentUser() user: AuthUser,
    @Param('teamId') teamId: string,
    @Query('q') q?: string,
    @Query('etiqueta') etiqueta?: string,
    @Query('columna') columna?: string,
    @Query('origen') origen?: string,
  ) {
    return this.contactos.idsDelFiltro(user, teamId, { q, etiqueta, columna, origen });
  }

  @Get('flujos')
  flujos(@CurrentUser() user: AuthUser, @Param('teamId') teamId: string) {
    return this.contactos.flujos(user, teamId);
  }

  @Get('duplicado')
  duplicado(
    @CurrentUser() user: AuthUser,
    @Param('teamId') teamId: string,
    @Query('telefono') telefono?: string,
  ) {
    return this.contactos.duplicado(user, teamId, telefono ?? '');
  }

  @Post('lote/etiquetar')
  etiquetar(@CurrentUser() user: AuthUser, @Param('teamId') teamId: string, @Body() body: EtiquetarBody) {
    return this.contactos.etiquetarEnLote(user, teamId, body.ids, body.etiqueta);
  }

  @Post('lote/inscribir')
  inscribir(@CurrentUser() user: AuthUser, @Param('teamId') teamId: string, @Body() body: InscribirBody) {
    return this.contactos.inscribirEnLote(user, teamId, body.ids, body.flujoId);
  }

  @Post('lote/eliminar')
  eliminar(@CurrentUser() user: AuthUser, @Param('teamId') teamId: string, @Body() body: IdsBody) {
    return this.contactos.eliminarEnLote(user, teamId, body.ids);
  }

  @Get('vistas')
  vistas(@CurrentUser() user: AuthUser, @Param('teamId') teamId: string) {
    return this.contactos.vistas(user, teamId);
  }

  @Post('vistas')
  crearVista(@CurrentUser() user: AuthUser, @Param('teamId') teamId: string, @Body() body: VistaBody) {
    return this.contactos.crearVista(user, teamId, body.nombre, body.filtros ?? {});
  }

  @Delete('vistas/:vistaId')
  borrarVista(
    @CurrentUser() user: AuthUser,
    @Param('teamId') teamId: string,
    @Param('vistaId') vistaId: string,
  ) {
    return this.contactos.borrarVista(user, teamId, vistaId);
  }
}
