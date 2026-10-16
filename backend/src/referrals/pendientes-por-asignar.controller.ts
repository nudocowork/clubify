import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { IsString } from 'class-validator';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';
import { SoloPlataformaGuard } from '../common/guards/solo-plataforma.guard';
import { PendientesPorAsignarService } from './pendientes-por-asignar.service';

class AsignarVendedorBody {
  @IsString() codeId!: string;
}

/**
 * «Pendientes por asignar vendedor» + «Venta directa».
 *
 * `SoloPlataformaGuard` además de `@Roles`: el admin de una marca blanca ES un
 * SUPER_ADMIN con `whiteLabelId`, y con el rol solo podría leer la cartera de
 * Clubify y atribuir sus ventas. Esto es de la plataforma.
 *
 * Prefijo propio (no `admin/commissions/...`): ese controlador tiene rutas
 * `:id/...` que se comerían un segmento fijo nuevo según el orden de registro.
 */
@UseGuards(SoloPlataformaGuard)
@Roles('SUPER_ADMIN')
@Controller('admin/pendientes-por-asignar')
export class PendientesPorAsignarController {
  constructor(private svc: PendientesPorAsignarService) {}

  @Get()
  listar() {
    return this.svc.listar();
  }

  @Get('contador')
  contar() {
    return this.svc.contar();
  }

  @Get(':tenantId/estado')
  estado(@Param('tenantId') tenantId: string) {
    return this.svc.estadoDelNegocio(tenantId);
  }

  @Post(':tenantId/vendedor')
  asignarVendedor(
    @CurrentUser() user: AuthUser,
    @Param('tenantId') tenantId: string,
    @Body() body: AsignarVendedorBody,
  ) {
    return this.svc.asignarVendedor(user, tenantId, body.codeId);
  }

  @Post(':tenantId/venta-directa')
  ventaDirecta(@CurrentUser() user: AuthUser, @Param('tenantId') tenantId: string) {
    return this.svc.marcarVentaDirecta(user, tenantId);
  }
}
