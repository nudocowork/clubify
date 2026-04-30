import { Module } from '@nestjs/common';
import { StorefrontService } from './storefront.service';
import {
  StorefrontController,
  PublicStorefrontController,
} from './storefront.controller';

@Module({
  providers: [StorefrontService],
  controllers: [StorefrontController, PublicStorefrontController],
  exports: [StorefrontService],
})
export class StorefrontModule {}
