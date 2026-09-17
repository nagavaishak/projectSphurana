import { Module } from '@nestjs/common';
import { AppointmentsController } from './appointments.controller.js';

@Module({
  controllers: [AppointmentsController],
  providers: [],
  exports: [],
})
export class AppointmentsModule {}
