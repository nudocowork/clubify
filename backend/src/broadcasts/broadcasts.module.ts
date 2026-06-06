import { Module } from '@nestjs/common';
import { BroadcastsService } from './broadcasts.service';
import {
  BroadcastsAdminController,
  BroadcastsPublicController,
} from './broadcasts.controller';

@Module({
  providers: [BroadcastsService],
  controllers: [BroadcastsAdminController, BroadcastsPublicController],
  exports: [BroadcastsService],
})
export class BroadcastsModule {}
