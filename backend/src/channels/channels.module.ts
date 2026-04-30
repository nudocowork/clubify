import { Module } from '@nestjs/common';
import { ChannelsService } from './channels.service';
import { ChannelsController } from './channels.controller';
import { MessagesController } from './messages.controller';

@Module({
  providers: [ChannelsService],
  controllers: [ChannelsController, MessagesController],
  exports: [ChannelsService],
})
export class ChannelsModule {}
