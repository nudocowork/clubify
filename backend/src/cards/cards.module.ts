import { Module } from '@nestjs/common';
import { CardsService } from './cards.service';
import { CardsController } from './cards.controller';
import { CardUtmController, PublicUtmController } from './utm.controller';
import { JobsModule } from '../jobs/jobs.module';
import { WalletModule } from '../wallet/wallet.module';

@Module({
  imports: [JobsModule, WalletModule],
  providers: [CardsService],
  controllers: [CardsController, CardUtmController, PublicUtmController],
  exports: [CardsService],
})
export class CardsModule {}
