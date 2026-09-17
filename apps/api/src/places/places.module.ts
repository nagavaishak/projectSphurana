import { Module } from '@nestjs/common';
import { PlacesController } from './places.controller.js';

@Module({
  controllers: [PlacesController],
})
export class PlacesModule {}
