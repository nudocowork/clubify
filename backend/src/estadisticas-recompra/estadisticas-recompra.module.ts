import { Module } from '@nestjs/common';
import { EstadisticasRecompraController } from './estadisticas-recompra.controller';
import { EstadisticasRecompraService } from './estadisticas-recompra.service';

/** Recompra por negocio en el superadmin. PrismaService es global. */
@Module({
  controllers: [EstadisticasRecompraController],
  providers: [EstadisticasRecompraService],
})
export class EstadisticasRecompraModule {}
