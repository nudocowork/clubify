import { Module } from '@nestjs/common';
import { ServiceReservationsService } from './service-reservations.service';
import { ServiceReservationsController } from './service-reservations.controller';
import { PublicServiceReservationsController } from './public-service-reservations.controller';
import { IntegrationsModule } from '../integrations/integrations.module';

@Module({
  imports: [IntegrationsModule],
  providers: [ServiceReservationsService],
  controllers: [
    ServiceReservationsController,
    PublicServiceReservationsController,
  ],
  exports: [ServiceReservationsService],
})
export class ServiceReservationsModule {}
