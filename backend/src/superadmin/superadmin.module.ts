import { Module, forwardRef } from '@nestjs/common';
import { SuperAdminService } from './superadmin.service';
import { SuperAdminController, SuperAdminPublicController } from './superadmin.controller';
import { RenewalsService } from './renewals.service';
import { BrandIconService } from './brand-icon.service';
import { BrandAuditService } from './brand-audit.service';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { WhiteLabelNotificationsModule } from '../white-label-notifications/white-label-notifications.module';

@Module({
  imports: [AuditModule, forwardRef(() => AuthModule), WhiteLabelNotificationsModule],
  providers: [SuperAdminService, RenewalsService, BrandIconService, BrandAuditService],
  controllers: [SuperAdminController, SuperAdminPublicController],
  exports: [RenewalsService],
})
export class SuperAdminModule {}
