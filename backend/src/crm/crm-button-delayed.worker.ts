import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { QueueService } from '../jobs/queue.service';
import { CrmService } from './crm.service';

/**
 * Worker BullMQ que ejecuta CrmButtons con `delaySeconds > 0` después
 * del delay programado (F3).
 *
 * Side effects + envío SMS quedan diferidos hasta acá. Si no hay Redis,
 * el worker no se inicia y executeButton cae a ejecución inmediata.
 */
@Injectable()
export class CrmButtonDelayedWorker implements OnModuleInit {
  private logger = new Logger(CrmButtonDelayedWorker.name);

  constructor(
    private queue: QueueService,
    private crm: CrmService,
  ) {}

  onModuleInit() {
    this.queue.registerWorker('crm.execute_button_delayed', async (data) => {
      const { userId, buttonId, contactId } = data as {
        userId: string;
        buttonId: string;
        contactId: string;
      };
      if (!userId || !buttonId || !contactId) {
        this.logger.warn(
          'crm.execute_button_delayed sin payload completo — skip',
        );
        return;
      }
      this.logger.log(
        `delayed button: user=${userId} btn=${buttonId} contact=${contactId}`,
      );
      try {
        await this.crm.executeButtonImmediate(userId, buttonId, contactId);
      } catch (e) {
        this.logger.warn(
          `executeButtonImmediate falló: ${(e as Error).message}`,
        );
      }
    });
  }
}
