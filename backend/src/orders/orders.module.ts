import { Module } from '@nestjs/common';
import { OrdersService } from './orders.service';
import { OrdersController } from './orders.controller';
import { PublicOrdersController } from './public-orders.controller';
import { OrdersGateway } from './orders.gateway';
import { ChannelsModule } from '../channels/channels.module';
import { PromotionsModule } from '../promotions/promotions.module';
import { AutomationsModule } from '../automations/automations.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [ChannelsModule, PromotionsModule, AutomationsModule, AuthModule],
  providers: [OrdersService, OrdersGateway],
  controllers: [OrdersController, PublicOrdersController],
  exports: [OrdersService, OrdersGateway],
})
export class OrdersModule {}
