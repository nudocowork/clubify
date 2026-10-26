import { Controller, Get, UseGuards } from '@nestjs/common';
import { Roles } from '../common/decorators/roles.decorator';
import { SoloPlataformaGuard } from '../common/guards/solo-plataforma.guard';
import { SalesWallService } from './sales-wall.service';

/**
 * /admin/sales-wall — ventas y renovaciones del mes para la pantalla de la
 * oficina. Solo SUPER_ADMIN de la plataforma: lleva montos y nombres de
 * afiliados, y la marca de la pantalla es Clubify.
 *
 * La pantalla lo consulta cada pocos segundos (polling): es una lectura
 * acotada al mes y con índice por fecha.
 */
@Controller('admin/sales-wall')
@Roles('SUPER_ADMIN')
@UseGuards(SoloPlataformaGuard)
export class SalesWallController {
  constructor(private readonly svc: SalesWallService) {}

  @Get()
  delMes() {
    return this.svc.delMes();
  }
}
