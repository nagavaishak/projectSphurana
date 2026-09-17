import { Module } from '@nestjs/common';
import { SalesController } from './sales.controller.js';

@Module({
  controllers: [SalesController],
  providers: [],
  exports: [],
})
export class SalesModule {}
