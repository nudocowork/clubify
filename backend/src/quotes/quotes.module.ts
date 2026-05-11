import { Module } from '@nestjs/common';
import { QuotesService } from './quotes.service';
import { QuotesController } from './quotes.controller';
import { PublicQuotesController } from './public-quotes.controller';
import { SettingsModule } from '../settings/settings.module';

@Module({
  imports: [SettingsModule],
  providers: [QuotesService],
  controllers: [QuotesController, PublicQuotesController],
})
export class QuotesModule {}
