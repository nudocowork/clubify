import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';
import { SoloPlataformaGuard } from '../common/guards/solo-plataforma.guard';
import { ReglasDeComisionService } from './reglas-de-comision.service';
import { APLICA_A, TIPOS_DE_REGLA } from './reglas-de-comision';

class CamposDeRegla {
  @IsOptional() @IsString() @MaxLength(120) nombre?: string | null;
  @IsOptional() @IsIn(TIPOS_DE_REGLA as unknown as string[]) tipo?: string;
  @IsOptional() @Type(() => Number) @IsNumber() valor?: number;
  @IsOptional() @IsIn(APLICA_A as unknown as string[]) aplicaA?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(10) @IsString({ each: true }) periodicidades?: string[];
  @IsOptional() @IsArray() @ArrayMaxSize(50) @IsString({ each: true }) planIds?: string[];
  @IsOptional() @IsString() vigenteDesde?: string | null;
  @IsOptional() @IsString() vigenteHasta?: string | null;
  @IsOptional() @IsBoolean() activo?: boolean;
  /** Obligatorio: queda en la auditoría. */
  @IsString() @MinLength(5) @MaxLength(1000) motivo!: string;
}

class ParticipacionBody extends CamposDeRegla {
  @IsOptional() @IsString() beneficiarioCodeId?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(500) @IsString({ each: true }) negociosIncluidos?: string[];
  @IsOptional() @IsArray() @ArrayMaxSize(500) @IsString({ each: true }) negociosExcluidos?: string[];
}

class ReglaColaboradorBody extends CamposDeRegla {
  @IsOptional() @IsString() codeId?: string;
  @IsOptional() @Type(() => Number) @IsInt() prioridad?: number;
}

/**
 * Pestaña «Reglas» de /admin/commissions: participaciones globales y reglas
 * por colaborador.
 *
 * `SoloPlataformaGuard` además de `@Roles`: el admin de una marca blanca ES un
 * SUPER_ADMIN con `whiteLabelId`, y con el rol solo podría darse una
 * participación sobre las ventas de Clubify. Ver [[clubify-marca-blanca-es-superadmin]].
 *
 * Prefijo propio (no `admin/commissions/...`): ese controlador tiene rutas
 * `:id/...` que se comerían un segmento fijo nuevo según el orden de registro.
 */
@UseGuards(SoloPlataformaGuard)
@Roles('SUPER_ADMIN')
@Controller('admin/reglas-de-comision')
export class ReglasDeComisionController {
  constructor(private svc: ReglasDeComisionService) {}

  @Get()
  listar() {
    return this.svc.listar();
  }

  @Get('codigos')
  codigos(@Query('q') q?: string) {
    return this.svc.buscarCodigos(q ?? '');
  }

  @Get('participaciones/simulacion')
  simular(@Query('desde') desde?: string, @Query('hasta') hasta?: string) {
    return this.svc.simularParticipaciones(desde, hasta);
  }

  @Get('participaciones/:id/historial')
  historialParticipacion(@Param('id') id: string) {
    return this.svc.historial('PARTICIPACION', id);
  }

  @Post('participaciones')
  crearParticipacion(@CurrentUser() user: AuthUser, @Body() body: ParticipacionBody) {
    const { motivo, ...datos } = body;
    return this.svc.crearParticipacion(user, datos, motivo);
  }

  @Patch('participaciones/:id')
  editarParticipacion(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: ParticipacionBody) {
    const { motivo, ...datos } = body;
    return this.svc.editarParticipacion(user, id, datos, motivo);
  }

  @Get('colaboradores/:id/historial')
  historialColaborador(@Param('id') id: string) {
    return this.svc.historial('COLABORADOR', id);
  }

  @Post('colaboradores')
  crearReglaDeColaborador(@CurrentUser() user: AuthUser, @Body() body: ReglaColaboradorBody) {
    const { motivo, ...datos } = body;
    return this.svc.crearReglaDeColaborador(user, datos, motivo);
  }

  @Patch('colaboradores/:id')
  editarReglaDeColaborador(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: ReglaColaboradorBody) {
    const { motivo, ...datos } = body;
    return this.svc.editarReglaDeColaborador(user, id, datos, motivo);
  }
}
