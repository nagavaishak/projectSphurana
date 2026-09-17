import { db } from '@borradh-workspace/database';
import {
  cancelPatientBooking,
  listPatientBookings,
  reschedulePatientBooking,
} from '@borradh-workspace/features/patient-bookings';
import { ErrorCodes } from '@borradh-workspace/features/shared';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Param,
  Post,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { CurrentPatient } from '../common/decorators/current-patient.decorator.js';
import type { PatientPrincipal } from '../common/guards/patient-auth.guard.js';
import { PatientAuthGuard } from '../common/guards/patient-auth.guard.js';
import {
  CancelPatientBookingDto,
  ReschedulePatientBookingDto,
} from './dto/index.js';

/**
 * The patient's own bookings (ENG-647 Phase 1) — guarded by
 * `PatientAuthGuard`, NEVER `AuthGuard`. The lead/org identity used for every
 * call is the one the guard resolved from the session cookie, so a patient can
 * only ever act on their own appointments (RLS `patient_self` enforces the
 * same at the database).
 */
@Controller('patient/bookings')
@UseGuards(PatientAuthGuard)
export class PatientBookingsController {
  @Get()
  async list(@CurrentPatient() patient: PatientPrincipal) {
    const result = await listPatientBookings(db, {
      leadId: patient.leadId,
      organizationId: patient.organizationId,
    });
    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @UsePipes(new ValidationPipe({ transform: true }))
  async cancel(
    @Param('id') appointmentId: string,
    @Body() dto: CancelPatientBookingDto,
    @CurrentPatient() patient: PatientPrincipal
  ) {
    const result = await cancelPatientBooking(db, {
      leadId: patient.leadId,
      organizationId: patient.organizationId,
      appointmentId,
      reason: dto.reason,
    });
    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  @Post(':id/reschedule')
  @HttpCode(HttpStatus.OK)
  @UsePipes(new ValidationPipe({ transform: true }))
  async reschedule(
    @Param('id') appointmentId: string,
    @Body() dto: ReschedulePatientBookingDto,
    @CurrentPatient() patient: PatientPrincipal
  ) {
    const result = await reschedulePatientBooking(db, {
      leadId: patient.leadId,
      organizationId: patient.organizationId,
      appointmentId,
      startTime: dto.startTime,
      endTime: dto.endTime,
    });
    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

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
