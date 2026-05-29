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
        // CRITICAL: NO re-throw. BullMQ retry sería peligroso porque
        // SEND_MESSAGE no es idempotente — si el SMS ya se mandó pero
        // processStep falló al actualizar lastActivityAt, el retry
        // mandaría el SMS DE NUEVO (2-3 veces al mismo cliente). El
        // enrollment ya se marca FAILED dentro de processStep si el
        // step falla; el log queda en SequenceExecution para auditar.
        // El user puede pause/resume para re-intentar manualmente.
        this.logger.error(
          `processStep(${enrollmentId}) falló: ${(e as Error).message}`,
        );
      }
    });
  }
}
