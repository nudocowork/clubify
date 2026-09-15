import { ROLES_DE_EQUIPO } from './team-access';
import { Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ConversacionesDeEquipoService } from './conversaciones-de-equipo.service';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';

/**
 * «Conversaciones» del equipo: la bandeja y la marca de leído.
 *
 * Controlador propio en `sales-teams/:teamId/conversaciones/…`. El hilo y el
 * envío siguen en `sales-teams/:teamId/leads/:leadId/chat`, que es de
 * `SalesChatController`. Nada del `SalesLeadsController` empieza por
 * `conversaciones`.
 */
@Controller('sales-teams/:teamId/conversaciones')
@Roles(...ROLES_DE_EQUIPO)
export class ConversacionesDeEquipoController {
  constructor(private conversaciones: ConversacionesDeEquipoService) {}

  @Get()
  bandeja(
    @CurrentUser() user: AuthUser,
    @Param('teamId') teamId: string,
    @Query('filtro') filtro?: string,
    @Query('q') q?: string,
    @Query('pagina') pagina?: string,
  ) {
    return this.conversaciones.bandeja(user, teamId, { filtro, q, pagina });
  }

  @Post(':leadId/leido')
  leido(@CurrentUser() user: AuthUser, @Param('teamId') teamId: string, @Param('leadId') leadId: string) {
    return this.conversaciones.marcarLeido(user, teamId, leadId);
  }
}
