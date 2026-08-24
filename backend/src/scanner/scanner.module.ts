import { Module } from '@nestjs/common';
import { ScannerService } from './scanner.service';
import { ScannerController } from './scanner.controller';
import { ReservationsModule } from '../reservations/reservations.module';
import { CuponeraModule } from '../cuponera/cuponera.module';

@Module({
  imports: [ReservationsModule, CuponeraModule],
  providers: [ScannerService],
  controllers: [ScannerController],
})
export class ScannerModule {}
