import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { RailwayMetricsService } from './railway-metrics.service';
import { ServerStatusController } from './server-status.controller';
import { ServerStatusService } from './server-status.service';

/**
 * Módulo "Estado del Servidor" (/superadmin → Plataforma). Centro de monitoreo
 * de infraestructura: métricas reales de Postgres + Railway API (best-effort) +
 * snapshots diarios para crecimiento/proyección. PrismaService es global.
 */
@Module({
  // AuthModule trae PreregAlertsService: la alerta de capacidad sale por SMS
  // al equipo, no por correo (ver checkAndAlert).
  imports: [AuthModule],
  controllers: [ServerStatusController],
  providers: [ServerStatusService, RailwayMetricsService],
})
export class ServerStatusModule {}
