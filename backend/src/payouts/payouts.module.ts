import { Module } from '@nestjs/common';
import { PayoutsService } from './payouts.service';
import {
  AffiliatePayoutsController,
  AdminPayoutsController,
} from './payouts.controller';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  providers: [PayoutsService],
  controllers: [AffiliatePayoutsController, AdminPayoutsController],
})
export class PayoutsModule {}
