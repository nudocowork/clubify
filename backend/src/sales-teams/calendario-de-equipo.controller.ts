import { Body, Controller, Delete, Get, Param, Post, Put, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Throttle } from '@nestjs/throttler';
import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';
import { CalendarioDeEquipoService } from './calendario-de-equipo.service';
import { ROLES_DE_EQUIPO } from './team-access';
import { Roles } from '../common/decorators/roles.decorator';
import { Public } from '../common/decorators/public.decorator';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';

/**
 * «📆 Conexión de Calendario / Correo» del equipo, en
 * `sales-teams/:teamId/calendario`. Quién puede cada cosa lo decide el servicio
 * (`resolveTeamAccess` + líder o admin de la marca).
 */

class IniciarBody {
  /** `window.location.origin` del panel: se valida contra los dominios permitidos. */
  @IsString() @MaxLength(200) origen!: string;
  @IsString() @MaxLength(300) ruta!: string;
}

class ConectarBody {
  @IsString() @MaxLength(2000) code!: string;
  @IsString() @MaxLength(2000) state!: string;
}

class PreferenciasBody {
  @IsOptional() @IsString() @MaxLength(300) calendarioId?: string;
  @IsOptional() @IsString() @MaxLength(3) colorId?: string | null;
  @IsOptional() @IsBoolean() crearSala?: boolean;
  @IsOptional() @IsBoolean() invitarCliente?: boolean;
  @IsOptional() @IsBoolean() invitarCloser?: boolean;
  @IsOptional() @IsBoolean() enviarInvitaciones?: boolean;
}

@Controller('sales-teams/:teamId/calendario')
@Roles(...ROLES_DE_EQUIPO)
export class CalendarioDeEquipoController {
  constructor(private calendario: CalendarioDeEquipoService) {}

  @Get()
  estado(@CurrentUser() user: AuthUser, @Param('teamId') teamId: string) {
    return this.calendario.estado(user, teamId);
  }

  @Post('iniciar')
  iniciar(@CurrentUser() user: AuthUser, @Param('teamId') teamId: string, @Body() body: IniciarBody) {
    return this.calendario.iniciar(user, teamId, body);
  }

  @Post('conectar')
  conectar(@CurrentUser() user: AuthUser, @Param('teamId') teamId: string, @Body() body: ConectarBody) {
    return this.calendario.conectar(user, teamId, body);
  }

  @Delete()
  desconectar(@CurrentUser() user: AuthUser, @Param('teamId') teamId: string) {
    return this.calendario.desconectar(user, teamId);
  }

  @Get('calendarios')
  calendarios(@CurrentUser() user: AuthUser, @Param('teamId') teamId: string) {
    return this.calendario.calendarios(user, teamId);
  }

  @Put('preferencias')
  preferencias(@CurrentUser() user: AuthUser, @Param('teamId') teamId: string, @Body() body: PreferenciasBody) {
    return this.calendario.guardarPreferencias(user, teamId, body);
  }

  @Post('probar')
  probar(@CurrentUser() user: AuthUser, @Param('teamId') teamId: string) {
    return this.calendario.probar(user, teamId);
  }

  @Post('generar-salas')
  generarSalas(@CurrentUser() user: AuthUser, @Param('teamId') teamId: string) {
    return this.calendario.generarSalasPendientes(user, teamId);
  }
}

/**
 * A donde vuelve Google tras el permiso. Público porque es el navegador quien
 * llega, sin la cabecera de sesión. No canjea nada: comprueba la firma del
 * `state` y devuelve el código al panel de origen (ver `vueltaDelCallback`).
 *
 * Parámetros sueltos y no un DTO: Google añade `scope`, `authuser`, `prompt`…
 * y un DTO estricto respondería 400 a una vuelta buena.
 */
@Controller('public/calendario-google')
export class CallbackDeCalendarioController {
  constructor(private calendario: CalendarioDeEquipoService) {}

  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  @Get('callback')
  callback(
    @Query('code') code: string | undefined,
    @Query('state') state: string | undefined,
    @Query('error') error: string | undefined,
    @Res() res: Response,
  ) {
    const r = this.calendario.vueltaDelCallback({ code, state, error });
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    if ('url' in r) return res.redirect(302, r.url);
    return res.status(400).type('html').send(r.html);
  }
}
