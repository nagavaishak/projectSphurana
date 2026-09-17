import { Module } from '@nestjs/common';
import { PatientAuthGuard } from '../common/guards/patient-auth.guard.js';
import { PatientBookingsController } from './patient-bookings.controller.js';

@Module({
  controllers: [PatientBookingsController],
  providers: [PatientAuthGuard],
})
export class PatientBookingsModule {}
