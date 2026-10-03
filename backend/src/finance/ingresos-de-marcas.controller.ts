import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';
import { SoloPlataformaGuard } from '../common/guards/solo-plataforma.guard';
import { IngresosDeMarcasService } from './ingresos-de-marcas.service';

/**
 * «Marcas blancas»: lo que cada marca le paga a la plataforma. Es dinero de la
 * plataforma, así que la puerta es la de Contabilidad: ninguna marca blanca la
 * cruza, ni para leer lo que pagan las demás.
 */
@UseGuards(SoloPlataformaGuard)
@Controller('admin/marcas-blancas/ingresos')
@Roles('SUPER_ADMIN')
export class IngresosDeMarcasController {
  constructor(private svc: IngresosDeMarcasService) {}

  @Get()
  resumen(@Query('periodo') periodo?: string) {
    return this.svc.resumen(periodo);
  }

  @Get(':whiteLabelId')
  movimientos(@Param('whiteLabelId') id: string, @Query('periodo') periodo?: string) {
    return this.svc.movimientos(id, periodo);
  }

  @Post()
  registrar(@Body() body: Record<string, string>, @CurrentUser() user: AuthUser) {
    return this.svc.registrar(body, user.id);
  }

  @Post(':id/anular')
  anular(@Param('id') id: string) {
    return this.svc.anular(id);
  }
}
