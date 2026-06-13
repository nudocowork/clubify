import { Module } from '@nestjs/common';
import { ReservationsService } from './reservations.service';
import { ReservationsController } from './reservations.controller';
import { PublicReservationsController } from './public-reservations.controller';
import { IntegrationsModule } from '../integrations/integrations.module';
import { WalletModule } from '../wallet/wallet.module';
import { PassesModule } from '../passes/passes.module';

@Module({
  imports: [IntegrationsModule, WalletModule, PassesModule],
  providers: [ReservationsService],
  controllers: [ReservationsController, PublicReservationsController],
})
export class ReservationsModule {}
