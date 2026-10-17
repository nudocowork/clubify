import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { IsBoolean, IsIn, IsNumber, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';
import { SoloPlataformaGuard } from '../common/guards/solo-plataforma.guard';
import { ReporteComisionesService, type Filtros } from './reporte-comisiones.service';
import { ACCIONES, esEstado, type Accion } from './estados';
import { esEquipo } from './equipos';
import { ESTADOS_INICIALES, TIPOS_MANUALES, type EstadoInicial, type TipoManual } from './comision-manual';
import { MOTIVO_MAX } from './auditoria';

class AccionBody {
  @IsIn(ACCIONES as unknown as string[]) accion!: Accion;
  @IsString() @MaxLength(MOTIVO_MAX) motivo!: string;
  /** Solo al reversar: anular también las demás comisiones de la misma venta. */
  @IsOptional() @IsBoolean() cascada?: boolean;
}

class NotaBody {
  @IsString() @MinLength(1) @MaxLength(4000) texto!: string;
  @IsOptional() @IsString() @MaxLength(1000) adjuntoUrl?: string;
  @IsOptional() @IsString() @MaxLength(120) adjuntoMime?: string;
}

class AnularNotaBody {
  @IsString() @MaxLength(MOTIVO_MAX) motivo!: string;
}

class PagoPersonaBody {
  @IsString() batchId!: string;
  @IsString() recipientCodeId!: string;
  @IsString() @MaxLength(MOTIVO_MAX) motivo!: string;
  @IsOptional() @IsString() @MaxLength(120) reference?: string;
  @IsOptional() @IsString() @MaxLength(1000) proofUrl?: string;
  @IsOptional() @IsString() @MaxLength(120) proofMimeType?: string;
  @IsOptional() @IsString() @MaxLength(500) notes?: string;
  @IsOptional() @IsString() paymentDate?: string;
}

class NuevaComisionBody {
  @IsString() @MaxLength(64) clave!: string;
  @IsString() fecha!: string;
  @IsString() recipientCodeId!: string;
  @IsOptional() @IsString() tenantId?: string | null;
  @IsOptional() @IsString() incomeRecordId?: string | null;
  @IsIn(TIPOS_MANUALES as unknown as string[]) tipo!: TipoManual;
  @IsNumber() baseUsd!: number;
  @IsOptional() @IsNumber() porcentaje?: number | null;
  @IsOptional() @IsNumber() montoFijoUsd?: number | null;
  @IsString() @MaxLength(2000) descripcion!: string;
  @IsIn(ESTADOS_INICIALES as unknown as string[]) estadoInicial!: EstadoInicial;
  @IsOptional() @IsString() @MaxLength(1000) comprobanteUrl?: string | null;
  @IsOptional() @IsString() @MaxLength(120) comprobanteMime?: string | null;
  @IsString() @MaxLength(MOTIVO_MAX) motivo!: string;
}

/** Los filtros llegan como texto en la query; lo que no se reconoce se ignora. */
function filtros(q: Record<string, string | undefined>): Filtros {
  return {
    desde: q.desde || undefined,
    hasta: q.hasta || undefined,
    colaborador: q.colaborador || undefined,
    equipo: esEquipo(q.equipo) ? q.equipo : undefined,
    negocio: q.negocio || undefined,
    periodicidad: q.periodicidad || undefined,
    tipoVenta: q.tipoVenta === 'NUEVA' || q.tipoVenta === 'RENOVACION' ? q.tipoVenta : undefined,
    estado: esEstado(q.estado) ? q.estado : undefined,
  };
}

/**
 * REPORTE DE COMISIONES (/reporte-comisiones).
 *
 * Solo la PLATAFORMA. `@Roles('SUPER_ADMIN')` no basta: el admin de una marca
 * blanca ES un SUPER_ADMIN con `whiteLabelId`, y esto cruza el dinero de los
 * colaboradores de Clubify, las ventas de todos sus negocios y los pagos. Por
 * eso `SoloPlataformaGuard` en la clase entera (y una prueba que se pone en rojo
 * si alguien lo quita). MARKETING no entra: el rol no está en `@Roles`.
 *
 * No hay un rol de «administrador financiero» en `Role` (MARKETING es
 * explícitamente «sin financiero»), así que hoy solo entra SUPER_ADMIN.
 *
 * Prefijo propio y no `admin/commissions/...`: ese controlador tiene rutas
 * `:id/...` que se comerían un segmento fijo nuevo según el orden de registro.
 */
@UseGuards(SoloPlataformaGuard)
@Roles('SUPER_ADMIN')
@Controller('admin/reporte-comisiones')
export class ReporteComisionesController {
  constructor(private svc: ReporteComisionesService) {}

  @Get('resumen')
  resumen(@Query() q: Record<string, string | undefined>) {
    return this.svc.resumen(filtros(q));
  }

  @Get('comisiones')
  listar(@Query() q: Record<string, string | undefined>) {
    return this.svc.listar(filtros(q), Number(q.page) || 1, Number(q.pageSize) || 50);
  }

  @Get('opciones')
  opciones() {
    return this.svc.opciones();
  }

  @Get('negocios')
  negocios(@Query('q') q?: string) {
    return this.svc.buscarNegocios(q ?? '');
  }

  @Get('negocios/:tenantId/ventas')
  ventasDelNegocio(@Param('tenantId') tenantId: string) {
    return this.svc.ventasDelNegocio(tenantId);
  }

  @Get('liquidaciones')
  liquidaciones(@Query('page') page?: string, @Query('pageSize') pageSize?: string) {
    return this.svc.liquidaciones(Number(page) || 1, Number(pageSize) || 50);
  }

  @Get('colaboradores/:codeId')
  colaborador(@Param('codeId') codeId: string, @Query() q: Record<string, string | undefined>) {
    return this.svc.colaborador(codeId, filtros(q));
  }

  @Get('comision/:id')
  descripcion(@Param('id') id: string) {
    return this.svc.descripcion(id);
  }

  @Post('comision/:id/accion')
  accion(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: AccionBody) {
    return this.svc.aplicarAccion(user, id, body);
  }

  @Post('comision/:id/notas')
  nota(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: NotaBody) {
    return this.svc.agregarNota(user, id, body);
  }

  @Post('notas/:notaId/anular')
  anularNota(@CurrentUser() user: AuthUser, @Param('notaId') notaId: string, @Body() body: AnularNotaBody) {
    return this.svc.anularNota(user, notaId, body);
  }

  @Post('pago-persona')
  pagoPersona(@CurrentUser() user: AuthUser, @Body() body: PagoPersonaBody) {
    return this.svc.registrarPagoPersona(user, body);
  }

  @Post('comisiones')
  crear(@CurrentUser() user: AuthUser, @Body() body: NuevaComisionBody) {
    return this.svc.crearManual(user, body);
  }
}
