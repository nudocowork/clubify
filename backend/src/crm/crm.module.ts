import { Module } from '@nestjs/common';
import { CrmService } from './crm.service';
import { CrmController } from './crm.controller';
import { CrmButtonDelayedWorker } from './crm-button-delayed.worker';
import { IntegrationsModule } from '../integrations/integrations.module';
import { SequencesModule } from '../sequences/sequences.module';

@Module({
  imports: [IntegrationsModule, SequencesModule],
  providers: [CrmService, CrmButtonDelayedWorker],
  controllers: [CrmController],
  exports: [CrmService],
})
export class CrmModule {}
