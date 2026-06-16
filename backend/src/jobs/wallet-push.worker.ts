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
      await this.wallet.pushPassUpdate(passId, { silent }).catch((e) => {
        this.logger.warn(
          `pushPassUpdate(${passId}) falló: ${(e as Error).message}`,
        );
      });
    });
  }
}
