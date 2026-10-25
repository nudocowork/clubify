import { Controller, Get } from '@nestjs/common';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';
import { BibliotecaInfolinksService } from './biblioteca-infolinks.service';

/**
 * /admin/biblioteca-infolinks. Mismos roles que Métricas (SUPER_ADMIN y
 * MARKETING), cada uno acotado a su marca en el servicio.
 */
@Controller('admin/biblioteca-infolinks')
@Roles('SUPER_ADMIN', 'MARKETING')
export class BibliotecaInfolinksController {
  constructor(private readonly svc: BibliotecaInfolinksService) {}

  @Get()
  listar(@CurrentUser() user: AuthUser) {
    return this.svc.listar(user);
  }
}
