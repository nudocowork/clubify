import { Module, forwardRef } from '@nestjs/common';
import { SuperAdminService } from './superadmin.service';
import { SuperAdminController, SuperAdminPublicController } from './superadmin.controller';
import { AdminAutomationsController } from './admin-automations.controller';
import { RenewalsService } from './renewals.service';
import { BrandIconService } from './brand-icon.service';
import { BrandAuditService } from './brand-audit.service';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { WhiteLabelNotificationsModule } from '../white-label-notifications/white-label-notifications.module';
import { IntegrationsModule } from '../integrations/integrations.module';

@Module({
  imports: [
    AuditModule,
    forwardRef(() => AuthModule),
    WhiteLabelNotificationsModule,
    IntegrationsModule,
  ],
  providers: [SuperAdminService, RenewalsService, BrandIconService, BrandAuditService],
  controllers: [
    SuperAdminController,
    SuperAdminPublicController,
    AdminAutomationsController,
  ],
  exports: [RenewalsService],
})
export class SuperAdminModule {}
