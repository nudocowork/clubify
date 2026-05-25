import { Module } from '@nestjs/common';
import { QrPostersService } from './qr-posters.service';
import {
  QrPostersController,
  QrPosterPublicRedirectController,
} from './qr-posters.controller';

@Module({
  providers: [QrPostersService],
  controllers: [QrPostersController, QrPosterPublicRedirectController],
})
export class QrPostersModule {}
