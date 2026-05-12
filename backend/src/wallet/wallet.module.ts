import { Module } from '@nestjs/common';
import { WalletService } from './wallet.service';
import { GoogleWalletService } from './google-wallet.service';
import { WalletController } from './wallet.controller';
import { CertMonitorService } from './cert-monitor.service';

@Module({
  providers: [WalletService, GoogleWalletService, CertMonitorService],
  controllers: [WalletController],
  exports: [WalletService, GoogleWalletService],
})
export class WalletModule {}
