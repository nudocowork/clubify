import { Module } from '@nestjs/common';
import { MetricasController } from './metricas.controller';
import { MetricasService } from './metricas.service';
import { MetricasDesgloseService } from './desglose.service';
import { EmbedMetricasController } from './embed-metricas.controller';
import { TenantsModule } from '../tenants/tenants.module';

/**
 * Métricas globales del panel /admin (página «Métricas»). Solo lee.
 *
 * No confundir con `src/metrics/`, que son las métricas DE UN negocio (su
 * panel /app). Esto cruza todos los negocios de la marca.
 */
@Module({
  imports: [TenantsModule],
  controllers: [MetricasController, EmbedMetricasController],
  providers: [MetricasService, MetricasDesgloseService],
})
export class MetricasModule {}
