import { Module } from '@nestjs/common';
import { ServiceReservationsService } from './service-reservations.service';
import { ServiceReservationsController } from './service-reservations.controller';
import { PublicServiceReservationsController } from './public-service-reservations.controller';

@Module({
  providers: [ServiceReservationsService],
  controllers: [
    ServiceReservationsController,
    PublicServiceReservationsController,
  ],
  exports: [ServiceReservationsService],
})
export class ServiceReservationsModule {}
