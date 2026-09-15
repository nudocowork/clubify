import { Body, Controller, Get, Param, Patch, Put } from '@nestjs/common';
import { IsArray, IsIn, IsObject, IsOptional, IsString, MaxLength } from 'class-validator';
import { ConfiguracionDeEquipoService } from './configuracion-de-equipo.service';
import { ROLES_DE_EQUIPO } from './team-access';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';

/**
 * «Configuración» del equipo, en `sales-teams/:teamId/configuracion`. Una ruta
 * por tarjeta de la pantalla: cada una guarda lo suyo y no pisa lo de las otras.
 */

class IdentidadBody {
  @IsOptional() @IsString() @MaxLength(80) nombre?: string;
  @IsOptional() @IsString() @MaxLength(240) descripcion?: string | null;
  @IsOptional() @IsString() @MaxLength(7) color?: string | null;
  @IsOptional() @IsIn(['activo', 'pausado', 'desactivado']) estado?: string;
  @IsOptional() @IsString() responsableId?: string | null;
}

class MensajeBody {
  @IsOptional() @IsString() @MaxLength(1000) mensaje?: string | null;
}

class BancoBody {
  /** Nombre de cada pestaña del Banco; lo limpia el servicio. */
  @IsOptional() @IsObject() etiquetas?: Record<string, unknown>;
  @IsOptional() @IsArray() @IsString({ each: true }) campos?: string[];
}

@Controller('sales-teams/:teamId/configuracion')
@Roles(...ROLES_DE_EQUIPO)
export class ConfiguracionDeEquipoController {
  constructor(private configuracion: ConfiguracionDeEquipoService) {}

  @Get()
  ver(@CurrentUser() user: AuthUser, @Param('teamId') teamId: string) {
    return this.configuracion.ver(user, teamId);
  }

  @Patch()
  guardarIdentidad(@CurrentUser() user: AuthUser, @Param('teamId') teamId: string, @Body() body: IdentidadBody) {
    return this.configuracion.guardarIdentidad(user, teamId, body);
  }

  @Put('mensaje')
  guardarMensaje(@CurrentUser() user: AuthUser, @Param('teamId') teamId: string, @Body() body: MensajeBody) {
    return this.configuracion.guardarMensaje(user, teamId, body);
  }

  @Put('banco')
  guardarBanco(@CurrentUser() user: AuthUser, @Param('teamId') teamId: string, @Body() body: BancoBody) {
    return this.configuracion.guardarBanco(user, teamId, body);
  }
}
