import { Controller, Get, Query } from '@nestjs/common';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';
import { CuponeraService } from './cuponera.service';

/**
 * PANEL DE LA CUPONERA (spec §4). Lo usa el administrador de UNA cuponera
 * (role=CUPONERA_ADMIN), que NO entra al Master Admin de Fidelity.
 *
 * Deliberadamente SEPARADO de CuponeraAdminController: aquel tiene 35+
 * endpoints, incluidos listar todas las cuponeras y crear administradores en
 * cualquiera. Sumar el rol a su @Roles habría sido una línea y una escalada de
 * privilegios. Acá solo entra lo que el admin de una cuponera debe ver.
 *
 * PLATFORM_OWNER también entra —§1 pide poder "entrar administrativamente a
 * cualquier cuponera"— y solo él puede pasar `?campaignId=`. Para el
 * CUPONERA_ADMIN ese parámetro se ignora o se rechaza: la campaña sale de su
 * sesión, nunca del cliente. La regla vive en `resolveAdminCampaign`.
 */
@Controller('cuponera/panel')
@Roles('CUPONERA_ADMIN', 'PLATFORM_OWNER', 'SUPER_ADMIN')
export class CuponeraPanelController {
  constructor(private svc: CuponeraService) {}

  /** Pantalla inicial: los números de §4. */
  @Get('overview')
  overview(@CurrentUser() user: AuthUser, @Query('campaignId') campaignId?: string) {
    return this.svc.panelOverview(user, campaignId);
  }

  @Get('allies')
  allies(@CurrentUser() user: AuthUser, @Query('campaignId') campaignId?: string) {
    return this.svc.panelAllies(user, campaignId);
  }

  @Get('members')
  members(@CurrentUser() user: AuthUser, @Query('campaignId') campaignId?: string) {
    return this.svc.panelMembers(user, campaignId);
  }

  @Get('redemptions')
  redemptions(@CurrentUser() user: AuthUser, @Query('campaignId') campaignId?: string) {
    return this.svc.panelRedemptions(user, campaignId);
  }
}
