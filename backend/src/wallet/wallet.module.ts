import { Module } from '@nestjs/common';
import { WalletService } from './wallet.service';
import { GoogleWalletService } from './google-wallet.service';
import { WalletController } from './wallet.controller';
import { CertMonitorService } from './cert-monitor.service';
import { LaboratorioDePaseController } from './laboratorio-de-pase.controller';
import { MediaModule } from '../media/media.module';

@Module({
  imports: [MediaModule],
  providers: [WalletService, GoogleWalletService, CertMonitorService],
  controllers: [WalletController, LaboratorioDePaseController],
  exports: [WalletService, GoogleWalletService],
})
export class WalletModule {}
