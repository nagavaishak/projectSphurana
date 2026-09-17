import { Module } from '@nestjs/common';
import { ProductBrandsController } from './product-brands.controller.js';
import { ProductCategoriesController } from './product-categories.controller.js';
import { ProductsController } from './products.controller.js';
import { PublicShopController } from './public-shop.controller.js';
import { StockOrdersController } from './stock-orders.controller.js';
import { StockTakesController } from './stock-takes.controller.js';
import { SuppliersController } from './suppliers.controller.js';

@Module({
  controllers: [
    ProductsController,
    PublicShopController,
    ProductBrandsController,
    ProductCategoriesController,
    SuppliersController,
    StockOrdersController,
    StockTakesController,
  ],
  providers: [],
  exports: [],
})
export class InventoryModule {}
