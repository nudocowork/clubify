import { Module } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { NotificationsController } from './notifications.controller';
import { RecurringNotificationsService } from './recurring-notifications.service';
import { RecurringNotificationsController } from './recurring-notifications.controller';
import { DevicesService } from './devices.service';
import { AppPushService } from './app-push.service';
import { DevicesController } from './devices.controller';
import { WalletModule } from '../wallet/wallet.module';

@Module({
  imports: [WalletModule],
  providers: [NotificationsService, RecurringNotificationsService, DevicesService, AppPushService],
  controllers: [NotificationsController, RecurringNotificationsController, DevicesController],
  exports: [NotificationsService, DevicesService, AppPushService],
})
export class NotificationsModule {}
