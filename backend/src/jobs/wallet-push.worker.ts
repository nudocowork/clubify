import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { QueueService } from './queue.service';
import { WalletService } from '../wallet/wallet.service';

/**
 * Worker que dispara push silenciosos a Apple Wallet cuando un pase fue
 * modificado (stamp/redeem/notification). Delega al WalletService real.
 */
@Injectable()
export class WalletPushWorker implements OnModuleInit {
  private logger = new Logger(WalletPushWorker.name);

  constructor(
    private queue: QueueService,
    private wallet: WalletService,
  ) {}

  onModuleInit() {
    this.queue.registerWorker('wallet.push', async (data) => {
      const { passId, reason, silent } = data as {
        passId: string;
        reason: string;
        silent?: boolean;
      };
      this.logger.log(
        `wallet.push job: pass=${passId} reason=${reason}${silent ? ' (silent)' : ''}`,
      );
      // RETRY DIFERENCIADO (2026-08): antes se tragaba TODO error → el job
      // "completaba" siempre y BullMQ nunca reintentaba (attempts:3 quedaba
      // muerto). Ahora:
      //  - Error TRANSITORIO de Google (status 'error' = 5xx/red/rate-limit) o
      //    una excepción inesperada → SE RELANZA → BullMQ reintenta 3x con
      //    backoff exponencial; tras agotarlos queda en la cola de fallidos
      //    (dead-letter, removeOnFail:5000) para inspección.
      //  - PERMANENTE (404 object_not_found = el cliente no saveó el pase; 403
      //    api_disabled) o éxito → NO se reintenta (return normal). Reintentar
      //    un 404/403 solo gasta llamadas.
      const result = (await this.wallet.pushPassUpdate(passId, { silent })) as {
        google?: { ok?: boolean; status?: string };
      };
      const gstatus = result?.google?.status;
      if (gstatus === 'error') {
        // Deja que BullMQ lo reintente.
        throw new Error(
          `wallet.push transitorio pass=${passId}: Google PATCH status=error`,
        );
      }
    });
  }
}
