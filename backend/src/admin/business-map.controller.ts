import { Controller, Get, Query } from '@nestjs/common';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';
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

  /**
   * `slug` = la marca que se está VIENDO (`/admin/sellea/map`). El panel
   * maestro no tiene `whiteLabelId` propio, así que sin este parámetro el
   * mapa de Sellea mostraba los negocios de TODAS las marcas mezclados.
   * Un admin de marca queda acotado a la suya, mande lo que mande.
   */
  @Get()
  list(@CurrentUser() user: AuthUser, @Query('marca') slug?: string) {
    return this.svc.list(user.whiteLabelId ?? null, slug?.trim() || null);
  }

  @Get('affiliates')
  affiliates(@CurrentUser() user: AuthUser) {
    return this.svc.listAffiliates(user.whiteLabelId ?? null);
  }
}
