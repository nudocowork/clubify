import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { QueueService } from '../jobs/queue.service';
import { SequencesService } from './sequences.service';

/**
 * Worker BullMQ que procesa los steps de Secuencias del CRM (F2).
 *
 * Cada `sequence.process_step` job lleva un `enrollmentId`. El worker
 * delega a `SequencesService.processStep` que ejecuta el step actual,
 * loguea la execution, y encola el siguiente step (con delay si es un
 * WAIT). Si no hay Redis, el worker no se inicia (modo stub del
 * QueueService) — las secuencias quedan inertes pero el panel sigue
 * funcionando para edición.
 */
@Injectable()
export class SequenceWorker implements OnModuleInit {
  private logger = new Logger(SequenceWorker.name);

  constructor(
    private queue: QueueService,
    private sequences: SequencesService,
  ) {}

  onModuleInit() {
    this.queue.registerWorker('sequence.process_step', async (data) => {
      const { enrollmentId } = data as { enrollmentId: string };
      if (!enrollmentId) {
        this.logger.warn('process_step job sin enrollmentId — skip');
        return;
      }
      this.logger.log(`sequence.process_step enrollment=${enrollmentId}`);
      try {
        await this.sequences.processStep(enrollmentId);
      } catch (e) {
        this.logger.error(
          `processStep(${enrollmentId}) falló: ${(e as Error).message}`,
        );
        throw e; // que BullMQ haga retry según attempts
      }
    });
  }
}
