import { Module } from '@nestjs/common';
import { PublicBookingController } from './public-booking.controller.js';

@Module({
  controllers: [PublicBookingController],
  providers: [],
  exports: [],
})
export class BookingFormsModule {}
