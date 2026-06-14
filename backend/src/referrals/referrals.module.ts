import { Module } from '@nestjs/common';
import { ReferralsService } from './referrals.service';
import {
  ReferralsController,
  AdminCommissionsController,
  SellerRegistrationController,
  PublicAffiliateSignupController,
  AdminAffiliateRegistrationController,
} from './referrals.controller';
import { AuthModule } from '../auth/auth.module';
import { AdminModule } from '../admin/admin.module';
import { AuditService } from '../audit/audit.service';
import { CommissionRecalcModule } from './commission-recalc.module';

@Module({
  imports: [AuthModule, AdminModule, CommissionRecalcModule],
  providers: [ReferralsService, AuditService],
  controllers: [
    ReferralsController,
    AdminCommissionsController,
    SellerRegistrationController,
    PublicAffiliateSignupController,
    AdminAffiliateRegistrationController,
  ],
  exports: [ReferralsService, AuditService],
})
export class ReferralsModule {}
