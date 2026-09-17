import { Module } from '@nestjs/common';
import { PatientAuthGuard } from '../common/guards/patient-auth.guard.js';
import { PatientDocumentsController } from './patient-documents.controller.js';
import { StaffPatientDocumentsController } from './staff-patient-documents.controller.js';

@Module({
  controllers: [PatientDocumentsController, StaffPatientDocumentsController],
  providers: [PatientAuthGuard],
})
export class PatientDocumentsModule {}
