import { Module } from '@nestjs/common';
import { ServiceCategoriesController } from './service-categories.controller.js';

@Module({
  controllers: [ServiceCategoriesController],
  providers: [],
  exports: [],
})
export class ServiceCategoriesModule {}
