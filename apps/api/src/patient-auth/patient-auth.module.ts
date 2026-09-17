import { Module } from '@nestjs/common';
import { PatientAuthGuard } from '../common/guards/patient-auth.guard.js';
import { PatientAuthController } from './patient-auth.controller.js';
import { PatientLogoutController } from './patient-logout.controller.js';
import { PatientPortalAccessController } from './patient-portal-access.controller.js';
import { PatientPortalController } from './patient-portal.controller.js';

@Module({
  controllers: [
    PatientAuthController,
    PatientLogoutController,
    PatientPortalController,
    PatientPortalAccessController,
  ],
  providers: [PatientAuthGuard],
})
export class PatientAuthModule {}
