import { Module } from '@nestjs/common';
import { GrowBusinessService } from './grow-business.service';
import { GrowBusinessController } from './grow-business.controller';
import { GrowBusinessAccountsService } from './grow-business-accounts.service';
import { GrowBusinessAccountsController } from './grow-business-accounts.controller';
import { CustomerOrderSmsService } from './customer-order-sms.service';

@Module({
  providers: [
    GrowBusinessService,
    GrowBusinessAccountsService,
    CustomerOrderSmsService,
  ],
  controllers: [GrowBusinessController, GrowBusinessAccountsController],
  exports: [
    GrowBusinessService,
    GrowBusinessAccountsService,
    CustomerOrderSmsService,
  ],
})
export class IntegrationsModule {}
