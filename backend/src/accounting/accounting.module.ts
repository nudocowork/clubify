import { Module } from '@nestjs/common';
import { AccountingService } from './accounting.service';
import { AccountingController } from './accounting.controller';
import { CommissionRecalcModule } from '../referrals/commission-recalc.module';

/**
 * Módulo contable (read-only) — asientos de doble partida derivados de las
 * comisiones. Importa CommissionRecalcModule para la base de comisión
 * (precio real ?? canónico). Guards de auth/roles son globales (APP_GUARD).
 */
@Module({
  imports: [CommissionRecalcModule],
  providers: [AccountingService],
  controllers: [AccountingController],
  exports: [AccountingService],
})
export class AccountingModule {}
