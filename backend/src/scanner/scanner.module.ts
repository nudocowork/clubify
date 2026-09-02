import { Module } from '@nestjs/common';
import { ScannerService } from './scanner.service';
import { ScannerController } from './scanner.controller';
import { ReservationsModule } from '../reservations/reservations.module';
import { CuponeraModule } from '../cuponera/cuponera.module';
import { ConveniosModule } from '../convenios/convenios.module';
import { ClubModule } from '../club/club.module';

@Module({
  imports: [ReservationsModule, CuponeraModule, ConveniosModule, ClubModule],
  providers: [ScannerService],
  controllers: [ScannerController],
})
export class ScannerModule {}
