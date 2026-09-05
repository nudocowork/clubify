import { Module } from '@nestjs/common';
import { ReservationsService } from './reservations.service';
import { ReservationsController } from './reservations.controller';
import { PublicReservationsController } from './public-reservations.controller';
import { EventsService } from './events.service';
import { EventsController } from './events.controller';
import { PublicEventsController } from './public-events.controller';
import { IntegrationsModule } from '../integrations/integrations.module';
import { WalletModule } from '../wallet/wallet.module';
import { PassesModule } from '../passes/passes.module';

@Module({
  imports: [IntegrationsModule, WalletModule, PassesModule],
  providers: [ReservationsService, EventsService],
  controllers: [
    ReservationsController,
    PublicReservationsController,
    EventsController,
    PublicEventsController,
  ],
  exports: [ReservationsService],
})
export class ReservationsModule {}
