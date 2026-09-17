import { Module } from '@nestjs/common';
import { PublicVenueController } from './public-venue.controller.js';
import { VenueController } from './venue.controller.js';

@Module({
  controllers: [VenueController, PublicVenueController],
})
export class VenueModule {}
