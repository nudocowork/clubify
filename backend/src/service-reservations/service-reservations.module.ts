import { Module } from '@nestjs/common';
import { ServiceReservationsService } from './service-reservations.service';
import { ServiceReservationsController } from './service-reservations.controller';

@Module({
  providers: [ServiceReservationsService],
  controllers: [ServiceReservationsController],
  exports: [ServiceReservationsService],
})
export class ServiceReservationsModule {}
