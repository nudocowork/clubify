import { Controller, Get, Param } from '@nestjs/common';
import { Roles } from '../common/decorators/roles.decorator';
import { SuperAdminService } from './superadmin.service';

/**
 * Endpoints del MasterAdmin (Nivel 1 / Plataforma).
 *
 * Solo accesibles para PLATFORM_OWNER. La ruta base es /superadmin
 * y queda completamente aislada de los endpoints de Tenant (Clubify
 * y demás marcas blancas).
 */
@Controller('superadmin')
@Roles('PLATFORM_OWNER')
export class SuperAdminController {
  constructor(private svc: SuperAdminService) {}

  @Get('dashboard')
  dashboard() {
    return this.svc.dashboard();
  }

  @Get('white-labels')
  listWhiteLabels() {
    return this.svc.listWhiteLabels();
  }

  @Get('white-labels/:id')
  getWhiteLabel(@Param('id') id: string) {
    return this.svc.getWhiteLabel(id);
  }
}
