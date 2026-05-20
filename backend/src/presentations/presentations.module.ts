import { Module } from '@nestjs/common';
import { PresentationsService } from './presentations.service';
import {
  PresentationsAdminController,
  PresentationsPublicController,
} from './presentations.controller';

@Module({
  providers: [PresentationsService],
  controllers: [
    PresentationsAdminController,
    PresentationsPublicController,
  ],
  exports: [PresentationsService],
})
export class PresentationsModule {}
