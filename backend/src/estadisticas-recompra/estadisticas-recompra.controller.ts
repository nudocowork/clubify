import { Controller, Get, Query } from '@nestjs/common';
import { Roles } from '../common/decorators/roles.decorator';
import { EstadisticasRecompraService } from './estadisticas-recompra.service';

/**
 * Recompra por negocio (/superadmin/recompra). Solo PLATFORM_OWNER: cruza
 * negocios de TODAS las marcas, y `@Roles('SUPER_ADMIN')` no aísla marcas.
 * Guards globales (JwtAuthGuard + RolesGuard) → aquí solo @Roles.
 */
@Controller('superadmin/recompra')
@Roles('PLATFORM_OWNER')
export class EstadisticasRecompraController {
  constructor(private readonly svc: EstadisticasRecompraService) {}

  @Get()
  resumen(@Query('refrescar') refrescar?: string) {
    return this.svc.resumen(refrescar === '1');
  }
}
