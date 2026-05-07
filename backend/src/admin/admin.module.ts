import { Module } from '@nestjs/common';
import { RemindersService } from './reminders.service';
import { RemindersController } from './reminders.controller';
import { SuppliersService } from './suppliers.service';
import { PurchaseOrdersService } from './purchase-orders.service';
import { AdminController } from './admin.controller';
import { IntegrationsModule } from '../integrations/integrations.module';

@Module({
  imports: [IntegrationsModule],
  providers: [RemindersService, SuppliersService, PurchaseOrdersService],
  controllers: [RemindersController, AdminController],
  exports: [RemindersService],
})
export class AdminModule {}
