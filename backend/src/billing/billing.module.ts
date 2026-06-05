import { Module } from '@nestjs/common';
import { BillingService } from './billing.service';
import { BillingController } from './billing.controller';
import { HotmartService } from './hotmart.service';
import {
  HotmartWebhookController,
  HotmartCheckoutController,
} from './hotmart.controller';
import { HotmartSimulatorController } from './hotmart-simulator.controller';
import { IntegrationsModule } from '../integrations/integrations.module';
import { EmailModule } from '../email/email.module';
import { ReferralsModule } from '../referrals/referrals.module';

@Module({
  imports: [IntegrationsModule, EmailModule, ReferralsModule],
  controllers: [
    BillingController,
    HotmartWebhookController,
    HotmartCheckoutController,
    HotmartSimulatorController,
  ],
  providers: [BillingService, HotmartService],
  exports: [BillingService, HotmartService],
})
export class BillingModule {}
