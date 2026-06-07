import { Module } from '@nestjs/common';
import { ReferralsService } from './referrals.service';
import {
  ReferralsController,
  AdminCommissionsController,
  SellerRegistrationController,
} from './referrals.controller';
import { AuthModule } from '../auth/auth.module';
import { AdminModule } from '../admin/admin.module';

@Module({
  imports: [AuthModule, AdminModule],
  providers: [ReferralsService],
  controllers: [
    ReferralsController,
    AdminCommissionsController,
    SellerRegistrationController,
  ],
  exports: [ReferralsService],
})
export class ReferralsModule {}
