import { Module } from '@nestjs/common';
import { CouponsService } from './coupons.service';
import { CouponsController, PublicPromoController } from './coupons.controller';

@Module({
  providers: [CouponsService],
  controllers: [CouponsController, PublicPromoController],
  exports: [CouponsService],
})
export class CouponsModule {}
