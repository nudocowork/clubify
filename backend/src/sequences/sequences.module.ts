import { Module } from '@nestjs/common';
import { SequencesService } from './sequences.service';
import { SequencesController } from './sequences.controller';
import { SequenceWorker } from './sequence-worker.service';
import { IntegrationsModule } from '../integrations/integrations.module';

/**
 * Módulo de Secuencias / Automatizaciones (F2). Engine de workflows
 * tipo GHL/ActiveCampaign — el afiliado define una secuencia de pasos
 * y los contactos se enrollan vía trigger. SequenceWorker procesa los
 * jobs BullMQ (`sequence.process_step`) y delega al service.
 *
 * Depende de IntegrationsModule para GrowBusinessService (envío SMS).
 */
@Module({
  imports: [IntegrationsModule],
  providers: [SequencesService, SequenceWorker],
  controllers: [SequencesController],
  exports: [SequencesService],
})
export class SequencesModule {}
