import { Module } from '@nestjs/common';
import { WalletService } from './wallet.service';
import { GoogleWalletService } from './google-wallet.service';
import { WalletController } from './wallet.controller';

@Module({
  providers: [WalletService, GoogleWalletService],
  controllers: [WalletController],
  exports: [WalletService, GoogleWalletService],
})
export class WalletModule {}
