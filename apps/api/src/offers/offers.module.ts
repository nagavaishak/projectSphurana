import { Module } from '@nestjs/common';
import { OffersController } from './offers.controller.js';

@Module({
  controllers: [OffersController],
  providers: [],
  exports: [],
})
export class OffersModule {}
