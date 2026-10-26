import { BadRequestException, Controller, ForbiddenException, Get, Query } from '@nestjs/common';
import { timingSafeEqual } from 'crypto';
import { Public } from '../common/decorators/public.decorator';
import { PrismaService } from '../common/prisma/prisma.service';
import { TenantsService } from '../tenants/tenants.service';
import { MetricasService } from './metricas.service';
import { MetricasDesgloseService } from './desglose.service';
import { METRICAS_DESGLOSE, esMetricaDesglose } from './desglose';
import { PRESETS, RangoInvalido, type Preset } from './rango';

/** Ajuste donde vive el token del embed. Lo crea `scripts/crear-embed-metricas.cjs`. */
export const CLAVE_TOKEN_EMBED_METRICAS = 'metricas.embedToken';

/**
 * Métricas de Clubify para mostrar DENTRO de TeamClubify (Team Soporte), en un
 * iframe (Javier, 2026-10-26). Quien mira está logueado en TeamClubify, no en
 * Clubify: no hay sesión, así que se entra con un token largo en la URL.
 *
 * SOLO LECTURA y solo lo que ya enseña /admin/metricas para la marca Clubify:
 * rankings de pases y pedidos, métricas generales y su desglose. Nada de
 * dinero ni datos de clientes. Sin token configurado, todo responde 403.
 */
@Controller('embed/metricas')
@Public()
export class EmbedMetricasController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenants: TenantsService,
    private readonly metricas: MetricasService,
    private readonly desgloseSvc: MetricasDesgloseService,
  ) {}

  private async exigirToken(t?: string) {
    const fila = await this.prisma.setting.findUnique({ where: { key: CLAVE_TOKEN_EMBED_METRICAS } });
    const esperado = (fila?.value ?? '').trim();
    const dado = (t ?? '').trim();
    const ok =
      esperado.length >= 32 &&
      dado.length === esperado.length &&
      timingSafeEqual(Buffer.from(dado), Buffer.from(esperado));
    if (!ok) throw new ForbiddenException('Enlace de métricas no válido.');
  }

  private preset(p?: string): Preset {
    return (PRESETS as readonly string[]).includes(p ?? '') ? (p as Preset) : '30d';
  }

  @Get('ranking')
  async ranking(
    @Query('t') t?: string,
    @Query('order') order?: string,
    @Query('criterio') criterio?: string,
    @Query('dias') dias?: string,
    @Query('metric') metric?: string,
  ) {
    await this.exigirToken(t);
    const n = Number(dias);
    const desde = Number.isFinite(n) && n > 0 ? new Date(Date.now() - n * 24 * 60 * 60 * 1000) : null;
    // Sin usuario = alcance de Clubify, igual que el super admin de la plataforma.
    return this.tenants.rankingByPasses(
      order === 'asc' ? 'asc' : 'desc',
      undefined,
      criterio === 'antiguedad' ? 'antiguedad' : 'pases',
      desde,
      metric === 'pedidos' ? 'pedidos' : 'pases',
    );
  }

  @Get('generales')
  async generales(
    @Query('t') t?: string,
    @Query('preset') preset?: string,
    @Query('desde') desde?: string,
    @Query('hasta') hasta?: string,
  ) {
    await this.exigirToken(t);
    try {
      return await this.metricas.generales(undefined, { preset: this.preset(preset), desde, hasta });
    } catch (e) {
      if (e instanceof RangoInvalido) throw new BadRequestException(e.message);
      throw e;
    }
  }

  @Get('desglose')
  async desglose(
    @Query('t') t?: string,
    @Query('metrica') metrica?: string,
    @Query('preset') preset?: string,
    @Query('desde') desde?: string,
    @Query('hasta') hasta?: string,
  ) {
    await this.exigirToken(t);
    if (!esMetricaDesglose(metrica)) {
      throw new BadRequestException(`metrica debe ser una de: ${METRICAS_DESGLOSE.join(', ')}.`);
    }
    try {
      return await this.desgloseSvc.desglose(undefined, { metrica, preset: this.preset(preset), desde, hasta });
    } catch (e) {
      if (e instanceof RangoInvalido) throw new BadRequestException(e.message);
      throw e;
    }
  }
}
