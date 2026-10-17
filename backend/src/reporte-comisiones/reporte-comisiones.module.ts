import { Module } from '@nestjs/common';
import { ReferralsModule } from '../referrals/referrals.module';
import { FinanceModule } from '../finance/finance.module';
import { ReporteComisionesController } from './reporte-comisiones.controller';
import { ReporteComisionesService } from './reporte-comisiones.service';

/**
 * Reporte de comisiones (/reporte-comisiones): visualización y gestión.
 *
 * No calcula comisiones: lee las tablas del motor y, para cambiar algo, llama
 * a los mismos métodos que /admin/commissions (ReferralsService, CutoffService),
 * que `ReferralsModule` ya exporta.
 *
 * `FinanceModule` entra solo para LEER la base del socio con la misma consulta
 * de Contabilidad (`IncomeRecordService.summary`), en vez de repetir la regla.
 */
@Module({
  imports: [ReferralsModule, FinanceModule],
  controllers: [ReporteComisionesController],
  providers: [ReporteComisionesService],
})
export class ReporteComisionesModule {}
