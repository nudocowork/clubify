import { Module, forwardRef } from '@nestjs/common';
import { RemindersService } from './reminders.service';
import { RemindersController } from './reminders.controller';
import { SuppliersService } from './suppliers.service';
import { PurchaseOrdersService } from './purchase-orders.service';
import { AdminController } from './admin.controller';
import { TrialsService } from './trials.service';
import { TrialsController } from './trials.controller';
import { BusinessMapService } from './business-map.service';
import { BusinessMapController } from './business-map.controller';
import { CommissionExceptionsService } from './commission-exceptions.service';
import { CommissionExceptionsController } from './commission-exceptions.controller';
import { IntegrationsModule } from '../integrations/integrations.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [IntegrationsModule, forwardRef(() => AuthModule)],
  providers: [
    RemindersService,
    SuppliersService,
    PurchaseOrdersService,
    TrialsService,
    BusinessMapService,
    CommissionExceptionsService,
  ],
  controllers: [
    RemindersController,
    AdminController,
    TrialsController,
    BusinessMapController,
    CommissionExceptionsController,
  ],
  exports: [RemindersService],
})
export class AdminModule {}
