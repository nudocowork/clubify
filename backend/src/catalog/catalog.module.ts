import { Module } from '@nestjs/common';
import { CategoriesService } from './categories.service';
import { CategoriesController } from './categories.controller';
import { ProductsService } from './products.service';
import { ProductsController } from './products.controller';
import { PublicMenuController } from './public-menu.controller';

@Module({
  providers: [CategoriesService, ProductsService],
  controllers: [CategoriesController, ProductsController, PublicMenuController],
  exports: [CategoriesService, ProductsService],
})
export class CatalogModule {}
