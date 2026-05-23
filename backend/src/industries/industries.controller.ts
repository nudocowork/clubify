import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { IndustriesService } from './industries.service';
import {
  CurrentUser,
  AuthUser,
} from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { Public } from '../common/decorators/public.decorator';

/**
 * Admin CRUD del módulo Industries. Solo SUPER_ADMIN.
 * F1: solo endpoints admin. La vista pública (lista de industrias activas
 * + detalle por slug) se agrega en F5 con su propio controller.
 *
 * Orden importa: /reorder DEBE declararse antes que /:id (sino el route
 * matching de Nest captura "reorder" como id literal).
 * Ver feedback_nestjs_route_order.md.
 */
@Controller('admin/industries')
@Roles('SUPER_ADMIN')
export class IndustriesAdminController {
  constructor(private svc: IndustriesService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.svc.listAll(user);
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() body: any) {
    return this.svc.create(user, body);
  }

  @Patch('reorder')
  reorder(
    @CurrentUser() user: AuthUser,
    @Body() body: { items: Array<{ id: string; sortOrder: number }> },
  ) {
    return this.svc.reorder(user, body?.items ?? []);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.svc.getById(user, id);
  }

  /** Asegura que la industria tenga una Presentation "default" y la devuelve.
   *  El admin lo usa para colapsar la UX (industria → editor de slides). */
  @Post(':id/ensure-default-presentation')
  ensureDefault(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.svc.ensureDefaultPresentation(user, id);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: any,
  ) {
    return this.svc.update(user, id, body);
  }

  @Delete(':id')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.svc.remove(user, id);
  }
}

/**
 * Controller PÚBLICO — sin auth. Sirve la vista cliente
 * (/industrias, /industria/{slug}). Solo expone industrias activas y,
 * por dentro, solo sus presentations activas (filtros del service).
 */
@Controller('public/industries')
@Public()
export class IndustriesPublicController {
  constructor(private svc: IndustriesService) {}

  @Get()
  list() {
    return this.svc.listPublic();
  }

  @Get(':slug')
  getBySlug(@Param('slug') slug: string) {
    return this.svc.getBySlugPublic(slug);
  }

  /** Deck unificado: industria + todos los slides de todas las presentations
   *  activas concatenados. Reemplaza la pantalla intermedia "lista de
   *  presentations" — al abrir /industria/:slug se ven los slides directos. */
  @Get(':slug/deck')
  getDeck(@Param('slug') slug: string) {
    return this.svc.getDeckBySlugPublic(slug);
  }
}
