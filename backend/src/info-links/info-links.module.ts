import { Module } from '@nestjs/common';
import { InfoLinksService } from './info-links.service';
import { InfoLinksController } from './info-links.controller';
import { PublicInfoLinksController } from './public-info-links.controller';
import { CatalogModule } from '../catalog/catalog.module';

@Module({
  imports: [CatalogModule],
  providers: [InfoLinksService],
  controllers: [InfoLinksController, PublicInfoLinksController],
  exports: [InfoLinksService],
})
export class InfoLinksModule {}
