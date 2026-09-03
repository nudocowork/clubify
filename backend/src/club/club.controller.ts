import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ClubService } from './club.service';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';

class TramoDto {
  @IsInt() @Min(1) @Max(31) desdeDia!: number;
  @IsInt() @Min(1) @Max(31) hastaDia!: number;
  @IsInt() @Min(0) beneficios!: number;
}

class CrearPlanDto {
  @IsString() @MaxLength(80) name!: string;
  @IsInt() @Min(1) @Max(1000) beneficiosPorMes!: number;
  @IsOptional() @IsString() @MaxLength(30) unidad?: string;
  @IsOptional() @IsInt() @Min(0) precioCents?: number;
  @IsOptional() @IsString() @MaxLength(8) currency?: string;
  @IsOptional() @IsString() @MaxLength(500) description?: string;
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => TramoDto)
  tramos?: TramoDto[];
}

class ActualizarPlanDto {
  @IsOptional() @IsString() @MaxLength(80) name?: string;
  @IsOptional() @IsInt() @Min(1) @Max(1000) beneficiosPorMes?: number;
  @IsOptional() @IsString() @MaxLength(30) unidad?: string;
  @IsOptional() @IsInt() @Min(0) precioCents?: number;
  @IsOptional() @IsString() @MaxLength(500) description?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => TramoDto)
  tramos?: TramoDto[];
}

class DisenoDto {
  @IsOptional() @IsString() @MaxLength(9) primaryColor?: string;
  @IsOptional() @IsString() @MaxLength(9) secondaryColor?: string;
  @IsOptional() @IsString() @MaxLength(500) logoUrl?: string | null;
  @IsOptional() @IsString() @MaxLength(16) stampIcon?: string;
  @IsOptional() @IsString() @MaxLength(500) stampIconImageUrl?: string | null;
  @IsOptional() @IsIn(['GRADIENT', 'SOLID', 'IMAGE'])
  stampBgType?: 'GRADIENT' | 'SOLID' | 'IMAGE';
  @IsOptional() @IsString() @MaxLength(500) stampBgImageUrl?: string | null;
}

class AltaRapidaDto {
  @IsString() @MaxLength(120) identificador!: string;
  /** El negocio ya vio la lista de parecidos y dijo que no es ninguno. */
  @IsOptional() @IsBoolean() forzarNuevo?: boolean;
}

class EstadoDto {
  @IsIn(['ACTIVA', 'PAUSADA', 'CANCELADA']) status!:
    | 'ACTIVA'
    | 'PAUSADA'
    | 'CANCELADA';
}

class ConsumirDto {
  @IsOptional() @IsInt() @Min(1) @Max(50) cantidad?: number;
  @IsOptional() @IsString() locationId?: string | null;
}

/**
 * El rol de CAJA (TENANT_STAFF) llega solo a lo de caja. Administrar el plan
 * —cambiar el cupo, los tramos, el precio— es del dueño. En Convenios está
 * todo bajo el mismo permiso y un cajero puede subirse el descuento: aquí no.
 */
@Controller('club')
export class ClubController {
  constructor(private svc: ClubService) {}

  @Get('estado')
  @Roles('TENANT_OWNER', 'SUPER_ADMIN')
  estado(@CurrentUser() user: AuthUser, @Query('tenantId') t?: string) {
    return this.svc.estadoDelModulo(user, t);
  }

  @Get('planes')
  @Roles('TENANT_OWNER', 'SUPER_ADMIN')
  listarPlanes(@CurrentUser() user: AuthUser, @Query('tenantId') t?: string) {
    return this.svc.listarPlanes(user, t);
  }

  @Post('planes')
  @Roles('TENANT_OWNER', 'SUPER_ADMIN')
  crearPlan(
    @CurrentUser() user: AuthUser,
    @Body() body: CrearPlanDto,
    @Query('tenantId') t?: string,
  ) {
    return this.svc.crearPlan(user, body, t);
  }

  @Patch('planes/:id')
  @Roles('TENANT_OWNER', 'SUPER_ADMIN')
  actualizarPlan(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: ActualizarPlanDto,
    @Query('tenantId') t?: string,
  ) {
    return this.svc.actualizarPlan(user, id, body, t);
  }

  @Get('planes/:id/miembros')
  @Roles('TENANT_OWNER', 'SUPER_ADMIN')
  listarMiembros(
    @CurrentUser() user: AuthUser,
    @Param('id') planId: string,
    @Query('q') q?: string,
    // Sin acotar, `?estado=FOO` llegaba tal cual al `where` de Prisma y
    // reventaba con un 500. No se alcanza desde el panel, pero la ruta es
    // pública para cualquiera con sesión de dueño.
    @Query('estado') estado?: 'TODAS' | 'ACTIVA' | 'PAUSADA' | 'CANCELADA',
    @Query('pagina') pagina?: string,
    @Query('tenantId') t?: string,
  ) {
    return this.svc.listarMiembros(
      user,
      planId,
      { q, estado, pagina: Number(pagina) || 1 },
      t,
    );
  }

  @Get('planes/:id/diseno')
  @Roles('TENANT_OWNER', 'SUPER_ADMIN')
  diseno(
    @CurrentUser() user: AuthUser,
    @Param('id') planId: string,
    @Query('tenantId') t?: string,
  ) {
    return this.svc.disenoDelPlan(user, planId, t);
  }

  @Patch('planes/:id/diseno')
  @Roles('TENANT_OWNER', 'SUPER_ADMIN')
  guardarDiseno(
    @CurrentUser() user: AuthUser,
    @Param('id') planId: string,
    @Body() body: DisenoDto,
    @Query('tenantId') t?: string,
  ) {
    return this.svc.guardarDiseno(user, planId, body, t);
  }

  /** Alta con un solo dato: el teléfono o el nombre. */
  @Post('planes/:id/alta-rapida')
  @Roles('TENANT_OWNER', 'SUPER_ADMIN')
  altaRapida(
    @CurrentUser() user: AuthUser,
    @Param('id') planId: string,
    @Body() body: AltaRapidaDto,
    @Query('tenantId') t?: string,
  ) {
    return this.svc.altaRapida(
      user,
      planId,
      body.identificador,
      body.forzarNuevo ?? false,
      t,
    );
  }

  @Post('planes/:id/miembros/:customerId')
  @Roles('TENANT_OWNER', 'SUPER_ADMIN')
  darDeAlta(
    @CurrentUser() user: AuthUser,
    @Param('id') planId: string,
    @Param('customerId') customerId: string,
    @Query('tenantId') t?: string,
  ) {
    return this.svc.darDeAlta(user, planId, customerId, t);
  }

  /**
   * Da de baja a TODOS los socios. Es la salida para cerrar el club: apagar el
   * plan solo cierra las altas nuevas, así que sin esto la única forma de
   * cerrarlo era entrar socio por socio.
   */
  @Post('planes/:id/dar-de-baja-a-todos')
  @Roles('TENANT_OWNER', 'SUPER_ADMIN')
  darDeBajaATodos(
    @CurrentUser() user: AuthUser,
    @Param('id') planId: string,
    @Query('tenantId') t?: string,
  ) {
    return this.svc.darDeBajaATodos(user, planId, t);
  }

  /** El historial de consumos del plan. Por defecto, el mes en curso. */
  @Get('planes/:id/consumos')
  @Roles('TENANT_OWNER', 'SUPER_ADMIN')
  consumos(
    @CurrentUser() user: AuthUser,
    @Param('id') planId: string,
    @Query('periodo') periodo?: string,
    @Query('membresiaId') membresiaId?: string,
    @Query('pagina') pagina?: string,
    @Query('tenantId') t?: string,
  ) {
    return this.svc.consumosDelPlan(
      user,
      planId,
      { periodo, membresiaId, pagina: Number(pagina) || 1 },
      t,
    );
  }

  /** El interruptor manual: si no pagó, se pausa. */
  @Patch('membresias/:id/estado')
  @Roles('TENANT_OWNER', 'SUPER_ADMIN')
  cambiarEstado(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: EstadoDto,
    @Query('tenantId') t?: string,
  ) {
    return this.svc.cambiarEstado(user, id, body.status, t);
  }

  // ── Caja ──────────────────────────────────────────────────────────────

  @Get('caja/pase/:passId')
  @Roles('TENANT_OWNER', 'TENANT_STAFF', 'SUPER_ADMIN')
  resolver(@CurrentUser() user: AuthUser, @Param('passId') passId: string) {
    return this.svc.resolverParaCaja(user, passId);
  }

  @Post('caja/consumir/:membresiaId')
  @Roles('TENANT_OWNER', 'TENANT_STAFF', 'SUPER_ADMIN')
  consumir(
    @CurrentUser() user: AuthUser,
    @Param('membresiaId') id: string,
    @Body() body: ConsumirDto,
  ) {
    return this.svc.consumir(user, id, body.cantidad ?? 1, body.locationId ?? null);
  }

  @Post('caja/anular/:consumoId')
  @Roles('TENANT_OWNER', 'TENANT_STAFF', 'SUPER_ADMIN')
  anular(@CurrentUser() user: AuthUser, @Param('consumoId') id: string) {
    return this.svc.anularConsumo(user, id);
  }
}
