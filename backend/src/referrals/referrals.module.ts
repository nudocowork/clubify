import { Module } from '@nestjs/common';
import { ReferralsService } from './referrals.service';
import {
  ReferralsController,
  AdminCommissionsController,
  SellerRegistrationController,
  AmbassadorRegistrationController,
  PublicAffiliateSignupController,
  AdminAffiliateRegistrationController,
} from './referrals.controller';
import { AuthModule } from '../auth/auth.module';
import { AdminModule } from '../admin/admin.module';
import { AuditService } from '../audit/audit.service';
import { CommissionRecalcModule } from './commission-recalc.module';
import { CutoffService } from './cutoff.service';

@Module({
  imports: [AuthModule, AdminModule, CommissionRecalcModule],
  // CutoffService depende de ReferralsService (para el desbloqueo del hold),
  // nunca al revés → sin ciclo, inyección directa.
  providers: [ReferralsService, AuditService, CutoffService],
  controllers: [
    ReferralsController,
    AdminCommissionsController,
    SellerRegistrationController,
    AmbassadorRegistrationController,
    PublicAffiliateSignupController,
    AdminAffiliateRegistrationController,
  ],
  exports: [ReferralsService, AuditService, CutoffService],
})
export class ReferralsModule {}
