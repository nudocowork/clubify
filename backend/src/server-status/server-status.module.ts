import { Module } from '@nestjs/common';
import { EmailModule } from '../email/email.module';
import { RailwayMetricsService } from './railway-metrics.service';
import { ServerStatusController } from './server-status.controller';
import { ServerStatusService } from './server-status.service';

/**
 * Módulo "Estado del Servidor" (/superadmin → Plataforma). Centro de monitoreo
 * de infraestructura: métricas reales de Postgres + Railway API (best-effort) +
 * snapshots diarios para crecimiento/proyección. PrismaService es global.
 */
@Module({
  imports: [EmailModule],
  controllers: [ServerStatusController],
  providers: [ServerStatusService, RailwayMetricsService],
})
export class ServerStatusModule {}
