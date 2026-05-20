import { Module } from '@nestjs/common';
import { PresentationsService } from './presentations.service';
import { PresentationsAdminController } from './presentations.controller';

@Module({
  providers: [PresentationsService],
  controllers: [PresentationsAdminController],
  exports: [PresentationsService],
})
export class PresentationsModule {}
