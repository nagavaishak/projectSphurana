import { Module } from '@nestjs/common';
import { GiftCardsController } from './gift-cards.controller.js';

@Module({
  controllers: [GiftCardsController],
  providers: [],
  exports: [],
})
export class GiftCardsModule {}
