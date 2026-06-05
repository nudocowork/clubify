import { Controller, Get } from '@nestjs/common';
import { Roles } from '../common/decorators/roles.decorator';
import { BusinessMapService } from './business-map.service';

/**
 * Panel /admin/map (SUPER_ADMIN). Devuelve la lista de tenants con
 * Locations y la lista de afiliados (embajadores + influencers) para
 * los dropdowns de filtro.
 *
 * Solo lectura. Cualquier mutación (asignar embajador, suspender, etc.)
 * sigue ocurriendo desde el detalle del tenant.
 */
@Controller('admin/business-map')
@Roles('SUPER_ADMIN')
export class BusinessMapController {
  constructor(private svc: BusinessMapService) {}

  @Get()
  list() {
    return this.svc.list();
  }

  @Get('affiliates')
  affiliates() {
    return this.svc.listAffiliates();
  }
}
