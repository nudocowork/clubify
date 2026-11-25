import { Body, Controller, Delete, Get, Param, Post, Put, Query } from '@nestjs/common';
import { IsIn, IsInt, IsObject, IsOptional, IsString, MaxLength, Max, Min } from 'class-validator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { FlujosService } from './flujos.service';

class CrearFlujoBody {
  @IsOptional() @IsString() @MaxLength(40) plantilla?: string;
  @IsOptional() @IsString() @MaxLength(120) name?: string;
}

/**
 * El grafo llega como objeto y se valida en el servicio (`limpiarGrafo` +
 * `problemasDeForma`): class-validator no sabe describir un árbol de nodos, y
 * lo que no pase esa validación no se guarda.
 */
class GuardarFlujoBody {
  @IsOptional() @IsString() @MaxLength(120) name?: string;
  @IsOptional() @IsString() @MaxLength(500) description?: string;
  @IsOptional() @IsString() @MaxLength(40) triggerType?: string;
  @IsOptional() @IsInt() @Min(1) @Max(365) triggerDays?: number | null;
  @IsOptional() @IsObject() triggerConfig?: Record<string, any>;
  @IsOptional() @IsObject() graph?: any;
  @IsOptional() @IsIn(['once', 'after_finish']) reentry?: string;
}

/**
 * Constructor visual de automatizaciones del negocio. Rutas de 2+ segmentos
 * bajo `automations/flujos`: no chocan con las de las reglas (`automations/:id`).
 * Todo pasa por `propio()`: el flujo se busca CON el negocio del usuario en el
 * WHERE, así que un id de otro negocio es un 404.
 */
@Controller('automations/flujos')
@Roles('TENANT_OWNER', 'SUPER_ADMIN')
export class FlujosController {
  constructor(private svc: FlujosService) {}

  @Get('catalogo')
  catalogo(@CurrentUser() u: AuthUser, @Query('tenantId') t?: string) {
    return this.svc.catalogo(u, t);
  }

  @Get()
  listar(@CurrentUser() u: AuthUser, @Query('tenantId') t?: string) {
    return this.svc.listar(u, t);
  }

  @Post()
  crear(@CurrentUser() u: AuthUser, @Body() b: CrearFlujoBody, @Query('tenantId') t?: string) {
    return this.svc.crear(u, b ?? {}, t);
  }

  @Get(':id')
  obtener(@CurrentUser() u: AuthUser, @Param('id') id: string, @Query('tenantId') t?: string) {
    return this.svc.obtener(u, id, t);
  }

  @Put(':id')
  guardar(
    @CurrentUser() u: AuthUser,
    @Param('id') id: string,
    @Body() b: GuardarFlujoBody,
    @Query('tenantId') t?: string,
  ) {
    return this.svc.guardar(u, id, b as any, t);
  }

  @Post(':id/validar')
  validar(@CurrentUser() u: AuthUser, @Param('id') id: string, @Query('tenantId') t?: string) {
    return this.svc.validar(u, id, t);
  }

  @Post(':id/activar')
  activar(@CurrentUser() u: AuthUser, @Param('id') id: string, @Query('tenantId') t?: string) {
    return this.svc.activar(u, id, t);
  }

  @Post(':id/pausar')
  pausar(@CurrentUser() u: AuthUser, @Param('id') id: string, @Query('tenantId') t?: string) {
    return this.svc.pausar(u, id, t);
  }

  @Post(':id/duplicar')
  duplicar(@CurrentUser() u: AuthUser, @Param('id') id: string, @Query('tenantId') t?: string) {
    return this.svc.duplicar(u, id, t);
  }

  @Delete(':id')
  eliminar(@CurrentUser() u: AuthUser, @Param('id') id: string, @Query('tenantId') t?: string) {
    return this.svc.eliminar(u, id, t);
  }

  @Get(':id/ejecuciones')
  ejecuciones(
    @CurrentUser() u: AuthUser,
    @Param('id') id: string,
    @Query('estado') estado?: string,
    @Query('pagina') pagina?: string,
    @Query('tenantId') t?: string,
  ) {
    return this.svc.ejecuciones(u, id, { estado, pagina }, t);
  }

  @Get(':id/ejecuciones/:enr')
  lineaDeTiempo(
    @CurrentUser() u: AuthUser,
    @Param('id') id: string,
    @Param('enr') enr: string,
    @Query('tenantId') t?: string,
  ) {
    return this.svc.lineaDeTiempo(u, id, enr, t);
  }

  @Post(':id/ejecuciones/:enr/cancelar')
  cancelar(
    @CurrentUser() u: AuthUser,
    @Param('id') id: string,
    @Param('enr') enr: string,
    @Query('tenantId') t?: string,
  ) {
    return this.svc.cancelarEjecucion(u, id, enr, t);
  }
}
