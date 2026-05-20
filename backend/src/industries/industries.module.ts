import { Module } from '@nestjs/common';
import { IndustriesService } from './industries.service';
import {
  IndustriesAdminController,
  IndustriesPublicController,
} from './industries.controller';

@Module({
  providers: [IndustriesService],
  controllers: [IndustriesAdminController, IndustriesPublicController],
  exports: [IndustriesService],
})
export class IndustriesModule {}
