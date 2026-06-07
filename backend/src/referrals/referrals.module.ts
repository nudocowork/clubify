import { Module } from '@nestjs/common';
import { ReferralsService } from './referrals.service';
import { CommissionRecalcService } from './commission-recalc.service';
import {
  ReferralsController,
  AdminCommissionsController,
  SellerRegistrationController,
} from './referrals.controller';
import { AuthModule } from '../auth/auth.module';
import { AdminModule } from '../admin/admin.module';
import { AuditService } from '../audit/audit.service';

@Module({
  imports: [AuthModule, AdminModule],
  providers: [ReferralsService, CommissionRecalcService, AuditService],
  controllers: [
    ReferralsController,
    AdminCommissionsController,
    SellerRegistrationController,
  ],
  exports: [ReferralsService, CommissionRecalcService, AuditService],
})
export class ReferralsModule {}
