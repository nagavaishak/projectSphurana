import { Module } from '@nestjs/common';
import { LocationOpeningHoursController } from './location-opening-hours.controller.js';

@Module({
  controllers: [LocationOpeningHoursController],
})
export class LocationOpeningHoursModule {}
