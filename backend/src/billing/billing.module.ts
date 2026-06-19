import { Module } from '@nestjs/common';
import { BillingService } from './billing.service';
import { BillingController } from './billing.controller';
import { HotmartService } from './hotmart.service';
import {
  HotmartWebhookController,
  HotmartCheckoutController,
} from './hotmart.controller';
import { HotmartSimulatorController } from './hotmart-simulator.controller';
import { SmsTemplatesService } from './sms-templates.service';
import { SmsTemplatesController } from './sms-templates.controller';
import { IntegrationsModule } from '../integrations/integrations.module';
import { EmailModule } from '../email/email.module';
import { ReferralsModule } from '../referrals/referrals.module';
import { AuthModule } from '../auth/auth.module';
import { AdminModule } from '../admin/admin.module';
import { WhiteLabelNotificationsModule } from '../white-label-notifications/white-label-notifications.module';
import { BusinessGroupsModule } from '../business-groups/business-groups.module';

@Module({
  imports: [IntegrationsModule, EmailModule, ReferralsModule, AuthModule, AdminModule, WhiteLabelNotificationsModule, BusinessGroupsModule],
  controllers: [
    BillingController,
    HotmartWebhookController,
    HotmartCheckoutController,
    HotmartSimulatorController,
    SmsTemplatesController,
  ],
  providers: [BillingService, HotmartService, SmsTemplatesService],
  exports: [BillingService, HotmartService, SmsTemplatesService],
})
export class BillingModule {}
