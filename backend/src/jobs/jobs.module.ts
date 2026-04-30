import { Global, Module } from '@nestjs/common';
import { QueueService } from './queue.service';
import { WalletPushWorker } from './wallet-push.worker';

@Global()
@Module({
  providers: [QueueService, WalletPushWorker],
  exports: [QueueService],
})
export class JobsModule {}
