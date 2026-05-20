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
