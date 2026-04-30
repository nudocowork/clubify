import { Module } from '@nestjs/common';
import { StampsService } from './stamps.service';
import { StampsController } from './stamps.controller';
import { WalletModule } from '../wallet/wallet.module';

@Module({
  imports: [WalletModule],
  providers: [StampsService],
  controllers: [StampsController],
  exports: [StampsService],
})
export class StampsModule {}
