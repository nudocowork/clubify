import { Module } from '@nestjs/common';
import { CommissionRecalcService } from './commission-recalc.service';
import { AuditService } from '../audit/audit.service';
import { SettingsModule } from '../settings/settings.module';

/**
 * Módulo standalone para CommissionRecalcService — extraído de
 * ReferralsModule para que AdminModule (CommissionExceptionsService)
 * pueda inyectarlo SIN ciclo (Admin ↔ Referrals).
 *
 * Fase E fix 2026-06-07: el ModuleRef.get + require inline NO
 * encontraba el service en runtime, así el recalc tras crear/editar
 * una excepción NUNCA corría. Ahora es inyección directa.
 *
 * Fix 2026-06-07: usa SettingsService.getLandingPlans() para precios
 * canónicos del bundle (no priceMonthly × cycle).
 */
@Module({
  imports: [SettingsModule],
  providers: [CommissionRecalcService, AuditService],
  exports: [CommissionRecalcService],
})
export class CommissionRecalcModule {}
