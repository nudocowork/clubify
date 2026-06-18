import { Module } from '@nestjs/common';
import { IntegrationsModule } from '../integrations/integrations.module';
import { WhiteLabelNotificationsService } from './white-label-notifications.service';

/**
 * SMS de créditos de la plataforma → marcas blancas. Módulo aislado (solo
 * depende de Integrations) para que Billing / Superadmin / AdminReports lo
 * consuman sin crear ciclos de DI.
 */
@Module({
  imports: [IntegrationsModule],
  providers: [WhiteLabelNotificationsService],
  exports: [WhiteLabelNotificationsService],
})
export class WhiteLabelNotificationsModule {}
