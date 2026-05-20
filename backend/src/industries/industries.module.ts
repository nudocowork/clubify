import { Module } from '@nestjs/common';
import { IndustriesService } from './industries.service';
import { IndustriesAdminController } from './industries.controller';

@Module({
  providers: [IndustriesService],
  controllers: [IndustriesAdminController],
  exports: [IndustriesService],
})
export class IndustriesModule {}
