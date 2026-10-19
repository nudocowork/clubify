import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';
import { MetricasService } from './metricas.service';
import { PRESETS, RangoInvalido, type Preset } from './rango';

const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * /admin/metricas (panel de la plataforma o de la marca).
 *
 * Roles y alcance IGUALES que el ranking de Negocios (`GET /tenants/ranking`):
 * SUPER_ADMIN y MARKETING, cada uno acotado a los negocios de la marca de su
 * sesión. Si un día se abre a más roles, el alcance de marca va con ellos:
 * vive en el servicio, no aquí.
 */
@Controller('admin/metricas')
@Roles('SUPER_ADMIN', 'MARKETING')
export class MetricasController {
  constructor(private readonly svc: MetricasService) {}

  /**
   * `tenantId` (opcional) deja preparado el filtro por negocio; el panel aún
   * no lo usa. Un id fuera de la marca responde 404.
   */
  @Get('generales')
  async generales(
    @CurrentUser() user: AuthUser,
    @Query('preset') preset?: string,
    @Query('desde') desde?: string,
    @Query('hasta') hasta?: string,
    @Query('tenantId') tenantId?: string,
  ) {
    const p: Preset = (PRESETS as readonly string[]).includes(preset ?? '') ? (preset as Preset) : '30d';
    if (tenantId && !RE_UUID.test(tenantId)) throw new BadRequestException('tenantId inválido.');
    try {
      return await this.svc.generales(user, { preset: p, desde, hasta, tenantId: tenantId || undefined });
    } catch (e) {
      // Un rango mal escrito es culpa de quien pregunta (400), no un 500.
      if (e instanceof RangoInvalido) throw new BadRequestException(e.message);
      throw e;
    }
  }
}
