import { Module } from '@nestjs/common';
import { ReservationsService } from './reservations.service';
import { ReservationsController } from './reservations.controller';
import { PublicReservationsController } from './public-reservations.controller';
import { IntegrationsModule } from '../integrations/integrations.module';

@Module({
  imports: [IntegrationsModule],
  providers: [ReservationsService],
  controllers: [ReservationsController, PublicReservationsController],
})
export class ReservationsModule {}
