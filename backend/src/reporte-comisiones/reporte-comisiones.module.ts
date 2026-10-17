import { Module } from '@nestjs/common';
import { ReferralsModule } from '../referrals/referrals.module';
import { ReporteComisionesController } from './reporte-comisiones.controller';
import { ReporteComisionesService } from './reporte-comisiones.service';

/**
 * Reporte de comisiones (/reporte-comisiones): visualización y gestión.
 *
 * No calcula comisiones: lee las tablas del motor y, para cambiar algo, llama
 * a los mismos métodos que /admin/commissions (ReferralsService, CutoffService),
 * que `ReferralsModule` ya exporta.
 */
@Module({
  imports: [ReferralsModule],
  controllers: [ReporteComisionesController],
  providers: [ReporteComisionesService],
})
export class ReporteComisionesModule {}
