import { Module } from '@nestjs/common';
import { CategoriesService } from './categories.service';
import { CategoriesController } from './categories.controller';
import { ProductsService } from './products.service';
import { ProductsController } from './products.controller';
import { PublicMenuController } from './public-menu.controller';
import { AdicionalesService } from './adicionales.service';
import { AdicionalesController } from './adicionales.controller';

@Module({
  providers: [CategoriesService, ProductsService, AdicionalesService],
  controllers: [
    CategoriesController,
    ProductsController,
    PublicMenuController,
    AdicionalesController,
  ],
  exports: [CategoriesService, ProductsService, AdicionalesService],
})
export class CatalogModule {}
