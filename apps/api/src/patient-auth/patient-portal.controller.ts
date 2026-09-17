import { db } from '@borradh-workspace/database';
import { getCurrentPatient } from '@borradh-workspace/features/patient-auth';
import { ErrorCodes } from '@borradh-workspace/features/shared';
import {
  Controller,
  Get,
  HttpException,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import { CurrentPatient } from '../common/decorators/current-patient.decorator.js';
import type { PatientPrincipal } from '../common/guards/patient-auth.guard.js';
import { PatientAuthGuard } from '../common/guards/patient-auth.guard.js';

/**
 * Authenticated patient-portal routes (ENG-647) — guarded by
 * `PatientAuthGuard`, NEVER `AuthGuard`. Mixing the two principal types on
 * one route is the failure mode most likely to leak data across the
 * org/patient boundary.
 *
 * `GET patient/me` is Phase 0's proof-of-scope: it runs under
 * `withPatientScope` on the `app_patient` pool, where the `patient_self` RLS
 * policy makes any row but the session's own lead literally invisible.
 */
@Controller('patient')
@UseGuards(PatientAuthGuard)
export class PatientPortalController {
  @Get('me')
  async me(@CurrentPatient() patient: PatientPrincipal) {
    const result = await getCurrentPatient(db, {
      leadId: patient.leadId,
      organizationId: patient.organizationId,
    });
    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  // NOTE: `POST patient/logout` lives in PatientLogoutController, UNguarded.
  // Requiring a resolvable X-Portal-Org to sign out meant a client that could
  // not resolve its clinic was refused — and never had its session revoked.

  private mapError(error: { code: string; message: string }) {
    const map: Record<string, HttpStatus> = {
      [ErrorCodes.VALIDATION_ERROR]: HttpStatus.BAD_REQUEST,
      [ErrorCodes.UNAUTHORIZED]: HttpStatus.UNAUTHORIZED,
      [ErrorCodes.FORBIDDEN]: HttpStatus.FORBIDDEN,
      [ErrorCodes.NOT_FOUND]: HttpStatus.NOT_FOUND,
      [ErrorCodes.ALREADY_EXISTS]: HttpStatus.CONFLICT,
      [ErrorCodes.CONFLICT]: HttpStatus.CONFLICT,
    };
    return new HttpException(
      error.message,
      map[error.code] || HttpStatus.INTERNAL_SERVER_ERROR
    );
  }
}
