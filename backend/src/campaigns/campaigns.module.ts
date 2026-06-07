import { Module } from '@nestjs/common';
import { CampaignsService } from './campaigns.service';
import { CampaignsController, PublicCampaignsController } from './campaigns.controller';
import { AuthModule } from '../auth/auth.module';
import { ReferralsModule } from '../referrals/referrals.module';
import { CommissionRecalcModule } from '../referrals/commission-recalc.module';

@Module({
  imports: [AuthModule, ReferralsModule, CommissionRecalcModule],
  providers: [CampaignsService],
  controllers: [CampaignsController, PublicCampaignsController],
  exports: [CampaignsService],
})
export class CampaignsModule {}
