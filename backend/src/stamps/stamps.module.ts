import { Module } from '@nestjs/common';
import { StampsService } from './stamps.service';
import { StampsController } from './stamps.controller';
import { WalletModule } from '../wallet/wallet.module';
import { BadgesModule } from '../badges/badges.module';
import { AutomationsModule } from '../automations/automations.module';
import { PassesModule } from '../passes/passes.module';

@Module({
  imports: [WalletModule, BadgesModule, AutomationsModule, PassesModule],
  providers: [StampsService],
  controllers: [StampsController],
  exports: [StampsService],
})
export class StampsModule {}
