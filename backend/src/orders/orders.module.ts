import { Module } from '@nestjs/common';
import { OrdersService } from './orders.service';
import { OwnerOrderAlertService } from './owner-order-alert.service';
import { OrdersController } from './orders.controller';
import { PublicOrdersController } from './public-orders.controller';
import { OrdersGateway } from './orders.gateway';
import { ChannelsModule } from '../channels/channels.module';
import { PromotionsModule } from '../promotions/promotions.module';
import { AutomationsModule } from '../automations/automations.module';
import { AuthModule } from '../auth/auth.module';
import { WalletModule } from '../wallet/wallet.module';
import { IntegrationsModule } from '../integrations/integrations.module';
import { DeliveryModule } from '../delivery/delivery.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [
    ChannelsModule,
    PromotionsModule,
    AutomationsModule,
    AuthModule,
    WalletModule,
    IntegrationsModule,
    DeliveryModule,
    NotificationsModule,
  ],
  providers: [OwnerOrderAlertService, OrdersService, OrdersGateway],
  controllers: [OrdersController, PublicOrdersController],
  exports: [OrdersService, OrdersGateway],
})
export class OrdersModule {}
