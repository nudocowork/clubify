import { Module } from '@nestjs/common';
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
import { CommissionsAuditService } from './commissions-audit.service';
import { CommissionsAuditController } from './commissions-audit.controller';
import { TenantDuplicatorService } from './tenant-duplicator.service';
import { TenantDuplicatorController } from './tenant-duplicator.controller';
import { MessageLogService } from './message-log.service';
import { MessageLogController } from './message-log.controller';
import { IntegrationsModule } from '../integrations/integrations.module';
import { AuthModule } from '../auth/auth.module';
import { CommissionRecalcModule } from '../referrals/commission-recalc.module';
import { SettingsModule } from '../settings/settings.module';

@Module({
  imports: [IntegrationsModule, AuthModule, CommissionRecalcModule, SettingsModule],
  providers: [
    RemindersService,
    SuppliersService,
    PurchaseOrdersService,
    TrialsService,
    BusinessMapService,
    CommissionExceptionsService,
    CommissionsAuditService,
    TenantDuplicatorService,
    MessageLogService,
  ],
  controllers: [
    RemindersController,
    AdminController,
    TrialsController,
    BusinessMapController,
    CommissionExceptionsController,
    CommissionsAuditController,
    TenantDuplicatorController,
    MessageLogController,
  ],
  exports: [RemindersService, CommissionExceptionsService],
})
export class AdminModule {}
