import { Module } from '@nestjs/common';
import { QrPostersService } from './qr-posters.service';
import { QrPostersController } from './qr-posters.controller';

@Module({
  providers: [QrPostersService],
  controllers: [QrPostersController],
})
export class QrPostersModule {}
