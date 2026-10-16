import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';
import { Roles } from '../common/decorators/roles.decorator';
import { SoloPlataformaGuard } from '../common/guards/solo-plataforma.guard';
import { AlertasDeSuscripcionService } from './alertas-de-suscripcion.service';

class RevisarBody {
  @IsString() @MaxLength(300) id!: string;
  /** false = devolverla a pendientes (por si se marcó sin querer). */
  @IsOptional() @IsBoolean() revisada?: boolean;
}

/**
 * Alertas de suscripciones de Hotmart (doble suscripción, huérfanas cobrando).
 *
 * `SoloPlataformaGuard` además de `@Roles`: el admin de una marca blanca es un
 * SUPER_ADMIN, y esto cruza los cobros de TODOS los negocios de todas las
 * marcas, con correos y teléfonos de compradores.
 */
@Controller('admin/alertas-de-suscripcion')
@UseGuards(SoloPlataformaGuard)
export class AlertasDeSuscripcionController {
  constructor(private svc: AlertasDeSuscripcionService) {}

  @Roles('SUPER_ADMIN')
  @Get()
  listar() {
    return this.svc.listar();
  }

  @Roles('SUPER_ADMIN')
  @Post('revisar')
  revisar(@Body() dto: RevisarBody) {
    return this.svc.marcarRevisada(dto.id, dto.revisada !== false);
  }
}
