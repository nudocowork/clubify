import { Controller, Get } from '@nestjs/common';
import { MisEquiposService } from './mis-equipos.service';
import { ROLES_DE_EQUIPO } from './team-access';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';

/**
 * `GET /sales-teams/mios`: los equipos de quien pregunta.
 *
 * Dos segmentos y no tres: ninguna ruta `sales-teams/:teamId/…` lo captura, y el
 * controlador de admin cuelga de `admin/sales-teams`.
 */
@Controller('sales-teams')
@Roles(...ROLES_DE_EQUIPO)
export class MisEquiposController {
  constructor(private equipos: MisEquiposService) {}

  @Get('mios')
  mios(@CurrentUser() user: AuthUser) {
    return this.equipos.mios(user);
  }
}
