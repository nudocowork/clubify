import { Module } from '@nestjs/common';
import { BillingService } from './billing.service';
import { BillingController } from './billing.controller';
import { HotmartService } from './hotmart.service';
import {
  HotmartWebhookController,
  HotmartCheckoutController,
} from './hotmart.controller';
import { IntegrationsModule } from '../integrations/integrations.module';
import { EmailModule } from '../email/email.module';

@Module({
  imports: [IntegrationsModule, EmailModule],
  controllers: [
    BillingController,
    HotmartWebhookController,
    HotmartCheckoutController,
  ],
  providers: [BillingService, HotmartService],
  exports: [BillingService, HotmartService],
})
export class BillingModule {}
