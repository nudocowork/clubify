import { Module } from '@nestjs/common';
import { BillingService } from './billing.service';
import { BillingController } from './billing.controller';
import { HotmartService } from './hotmart.service';
import {
  HotmartWebhookController,
  HotmartCheckoutController,
} from './hotmart.controller';
import { HotmartSimulatorController } from './hotmart-simulator.controller';
import { StripeService } from './stripe.service';
import { StripeWebhookController } from './stripe.controller';
import { CrossService } from './cross.service';
import { CrossWebhookController, CrossCheckoutController } from './cross.controller';
import { SmsTemplatesService } from './sms-templates.service';
import { SmsTemplatesController } from './sms-templates.controller';
import { PendingActivationService } from './pending-activation.service';
import { PendingPaymentsController } from './pending-payments.controller';
import { IntegrationsModule } from '../integrations/integrations.module';
import { EmailModule } from '../email/email.module';
import { ReferralsModule } from '../referrals/referrals.module';
import { AuthModule } from '../auth/auth.module';
import { AdminModule } from '../admin/admin.module';
import { WhiteLabelNotificationsModule } from '../white-label-notifications/white-label-notifications.module';
import { BusinessGroupsModule } from '../business-groups/business-groups.module';
import { OnboardingSyncModule } from '../onboarding-sync/onboarding-sync.module';

@Module({
  imports: [IntegrationsModule, EmailModule, ReferralsModule, AuthModule, AdminModule, WhiteLabelNotificationsModule, BusinessGroupsModule, OnboardingSyncModule],
  controllers: [
    BillingController,
    HotmartWebhookController,
    HotmartCheckoutController,
    HotmartSimulatorController,
    StripeWebhookController,
    CrossWebhookController,
    CrossCheckoutController,
    SmsTemplatesController,
    PendingPaymentsController,
  ],
  providers: [BillingService, HotmartService, StripeService, CrossService, SmsTemplatesService, PendingActivationService],
  exports: [BillingService, HotmartService, StripeService, CrossService, SmsTemplatesService],
})
export class BillingModule {}
