import { Module } from '@nestjs/common';
import { ReferralsService } from './referrals.service';
import { ReferralsController, AdminCommissionsController } from './referrals.controller';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  providers: [ReferralsService],
  controllers: [ReferralsController, AdminCommissionsController],
  exports: [ReferralsService],
})
export class ReferralsModule {}
