import { Module } from '@nestjs/common';
import { GrowBusinessService } from './grow-business.service';
import { GrowBusinessController } from './grow-business.controller';

@Module({
  providers: [GrowBusinessService],
  controllers: [GrowBusinessController],
  exports: [GrowBusinessService],
})
export class IntegrationsModule {}
