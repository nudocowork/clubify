import { Module, forwardRef } from '@nestjs/common';
import { SuperAdminService } from './superadmin.service';
import { SuperAdminController, SuperAdminPublicController } from './superadmin.controller';
import { AdminAutomationsController } from './admin-automations.controller';
import { BrandWorkflowsController } from './brand-workflows/brand-workflows.controller';
import { BrandWorkflowEngineService } from './brand-workflows/brand-workflow-engine.service';
import { BrandWorkflowFoldersService } from './brand-workflows/brand-workflow-folders.service';
import { RenewalsService } from './renewals.service';
import { BrandIconService } from './brand-icon.service';
import { BrandAuditService } from './brand-audit.service';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { IntegrationsModule } from '../integrations/integrations.module';
import { WhiteLabelNotificationsModule } from '../white-label-notifications/white-label-notifications.module';

@Module({
  imports: [AuditModule, forwardRef(() => AuthModule), IntegrationsModule, WhiteLabelNotificationsModule],
  providers: [SuperAdminService, RenewalsService, BrandIconService, BrandAuditService, BrandWorkflowEngineService, BrandWorkflowFoldersService],
  controllers: [
    SuperAdminController,
    SuperAdminPublicController,
    AdminAutomationsController,
    BrandWorkflowsController,
  ],
  exports: [RenewalsService],
})
export class SuperAdminModule {}
