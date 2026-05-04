import { Module } from '@nestjs/common';
import { BillingService } from './billing.service';
import { BillingController } from './billing.controller';
import { HotmartService } from './hotmart.service';
import {
  HotmartWebhookController,
  HotmartCheckoutController,
} from './hotmart.controller';

@Module({
  controllers: [
    BillingController,
    HotmartWebhookController,
    HotmartCheckoutController,
  ],
  providers: [BillingService, HotmartService],
  exports: [BillingService, HotmartService],
})
export class BillingModule {}
