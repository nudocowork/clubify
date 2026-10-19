import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';
import { MetricasService } from './metricas.service';
import { MetricasDesgloseService } from './desglose.service';
import { METRICAS_DESGLOSE, esMetricaDesglose } from './desglose';
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
  constructor(
    private readonly svc: MetricasService,
    private readonly desgloseSvc: MetricasDesgloseService,
  ) {}

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

  /**
   * El detalle por negocio de una tarjeta de «Métricas generales» (clic en la
   * tarjeta). Mismos roles y mismo alcance que `generales`: si no, la suma no
   * cuadraría con el número que se está queriendo confirmar.
   */
  @Get('desglose')
  async desglose(
    @CurrentUser() user: AuthUser,
    @Query('metrica') metrica?: string,
    @Query('preset') preset?: string,
    @Query('desde') desde?: string,
    @Query('hasta') hasta?: string,
  ) {
    if (!esMetricaDesglose(metrica)) {
      throw new BadRequestException(`metrica debe ser una de: ${METRICAS_DESGLOSE.join(', ')}.`);
    }
    const p: Preset = (PRESETS as readonly string[]).includes(preset ?? '') ? (preset as Preset) : '30d';
    try {
      return await this.desgloseSvc.desglose(user, { metrica, preset: p, desde, hasta });
    } catch (e) {
      if (e instanceof RangoInvalido) throw new BadRequestException(e.message);
      throw e;
    }
  }
}
