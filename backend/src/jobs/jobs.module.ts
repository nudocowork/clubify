import { Global, Module } from '@nestjs/common';
import { QueueService } from './queue.service';
import { WalletPushWorker } from './wallet-push.worker';
import { WalletModule } from '../wallet/wallet.module';

@Global()
@Module({
  imports: [WalletModule],
  providers: [QueueService, WalletPushWorker],
  exports: [QueueService],
})
export class JobsModule {}
