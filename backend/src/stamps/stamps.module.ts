import { Module } from '@nestjs/common';
import { StampsService } from './stamps.service';
import { StampsController } from './stamps.controller';
import { WalletModule } from '../wallet/wallet.module';
import { BadgesModule } from '../badges/badges.module';

@Module({
  imports: [WalletModule, BadgesModule],
  providers: [StampsService],
  controllers: [StampsController],
  exports: [StampsService],
})
export class StampsModule {}
