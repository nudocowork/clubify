import { Module } from '@nestjs/common';
import { ReferralsService } from './referrals.service';
import { ReferralsController } from './referrals.controller';

@Module({
  providers: [ReferralsService],
  controllers: [ReferralsController],
})
export class ReferralsModule {}
