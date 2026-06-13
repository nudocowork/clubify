import { Module } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { NotificationsController } from './notifications.controller';
import { RecurringNotificationsService } from './recurring-notifications.service';
import { RecurringNotificationsController } from './recurring-notifications.controller';
import { WalletModule } from '../wallet/wallet.module';

@Module({
  imports: [WalletModule],
  providers: [NotificationsService, RecurringNotificationsService],
  controllers: [NotificationsController, RecurringNotificationsController],
})
export class NotificationsModule {}
