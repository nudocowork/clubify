import { Module } from '@nestjs/common';
import { AffiliateService } from './affiliate.service';
import { AffiliateController } from './affiliate.controller';

@Module({
  providers: [AffiliateService],
  controllers: [AffiliateController],
})
export class AffiliateModule {}
