import { Module } from '@nestjs/common';
import { PatientAuthGuard } from '../common/guards/patient-auth.guard.js';
import { ConsentFormTemplatesController } from './consent-form-templates.controller.js';
import { PatientConsentFormsController } from './patient-consent-forms.controller.js';

@Module({
  controllers: [ConsentFormTemplatesController, PatientConsentFormsController],
  providers: [PatientAuthGuard],
})
export class ConsentFormsModule {}
