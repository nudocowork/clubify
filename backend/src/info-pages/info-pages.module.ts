import { Module } from '@nestjs/common';
import { InfoPagesService } from './info-pages.service';
import { InfoPagesController } from './info-pages.controller';
import { PublicInfoPagesController } from './public-info-pages.controller';
import { IntegrationInfoPagesController } from './integration-info-pages.controller';

@Module({
  providers: [InfoPagesService],
  controllers: [
    InfoPagesController,
    PublicInfoPagesController,
    IntegrationInfoPagesController,
  ],
  exports: [InfoPagesService],
})
export class InfoPagesModule {}
