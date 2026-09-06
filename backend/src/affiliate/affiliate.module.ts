import { Module } from '@nestjs/common';
import { AffiliateService } from './affiliate.service';
import { AffiliateSaleAlertsService } from './affiliate-sale-alerts.service';
import { AffiliateController } from './affiliate.controller';
import { AuthModule } from '../auth/auth.module';
import { CommissionRecalcModule } from '../referrals/commission-recalc.module';

@Module({
  imports: [AuthModule, CommissionRecalcModule],
  providers: [AffiliateService, AffiliateSaleAlertsService],
  controllers: [AffiliateController],
})
export class AffiliateModule {}
