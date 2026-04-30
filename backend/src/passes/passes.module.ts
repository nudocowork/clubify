import { Module } from '@nestjs/common';
import { PassesService } from './passes.service';
import { PassesController } from './passes.controller';
import { WalletModule } from '../wallet/wallet.module';

@Module({
  imports: [WalletModule],
  providers: [PassesService],
  controllers: [PassesController],
  exports: [PassesService],
})
export class PassesModule {}
