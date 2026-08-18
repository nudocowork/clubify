import { Module } from '@nestjs/common';
import { IntegrationsModule } from '../integrations/integrations.module';
import { MktProviderService } from './provider/mkt-provider.service';
import { MktContactService } from './mkt-contact.service';
import { MktActionService } from './mkt-action.service';
import { MktEngineService } from './mkt-engine.service';
import { MarketingController } from './marketing.controller';
import { MktWorkflowsController } from './mkt-workflows.controller';
import { MktWebhookController } from './mkt-webhook.controller';

/**
 * Motor de Email Marketing (contact-based) para las marcas — apartado de
 * automatizaciones. Módulo NUEVO y aislado; no toca `brand-workflows`
 * (tenant-based).
 *
 * PrismaModule es @Global → PrismaService disponible sin importarlo.
 * ScheduleModule es @Global (ya en la app) → los @Cron del motor corren.
 * IntegrationsModule exporta GrowBusinessService (proveedor de envío).
 */
@Module({
  imports: [IntegrationsModule],
  providers: [MktProviderService, MktContactService, MktActionService, MktEngineService],
  controllers: [MarketingController, MktWorkflowsController, MktWebhookController],
  exports: [MktProviderService, MktContactService, MktEngineService],
})
export class MarketingModule {}
