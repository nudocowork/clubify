import { Module } from '@nestjs/common';
import { CategoriesService } from './categories.service';
import { CategoriesController } from './categories.controller';
import { ProductsService } from './products.service';
import { ProductsController } from './products.controller';
import { PublicMenuController } from './public-menu.controller';
import { AdicionalesService } from './adicionales.service';
import { AdicionalesController } from './adicionales.controller';
import { TranslationService } from './translation.service';
import { TranslationsAdminService } from './translations.service';
import { TranslationsController } from './translations.controller';

@Module({
  providers: [
    CategoriesService,
    ProductsService,
    AdicionalesService,
    TranslationService,
    TranslationsAdminService,
  ],
  controllers: [
    CategoriesController,
    ProductsController,
    PublicMenuController,
    AdicionalesController,
    TranslationsController,
  ],
  exports: [
    CategoriesService,
    ProductsService,
    AdicionalesService,
    TranslationService,
  ],
})
export class CatalogModule {}
