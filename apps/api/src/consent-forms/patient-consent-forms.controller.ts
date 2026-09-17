import { db } from '@borradh-workspace/database';
import {
  getConsentPdfDownloadForPatient,
  getPatientConsentForm,
  listPatientConsentForms,
  signConsentForm,
} from '@borradh-workspace/features/consent-forms';
import { ErrorCodes } from '@borradh-workspace/features/shared';
import {
  Body,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { CurrentPatient } from '../common/decorators/current-patient.decorator.js';
import type {
  PatientPrincipal,
  PatientRequest,
} from '../common/guards/patient-auth.guard.js';
import { PatientAuthGuard } from '../common/guards/patient-auth.guard.js';
import { getClientIp } from '../common/net/client-ip.js';
import { ListPatientConsentFormsDto } from './dto/list-patient-consent-forms.dto.js';
import { SignConsentFormDto } from './dto/sign-consent-form.dto.js';

/**
 * Patient-portal consent forms (ENG-647 Phase 3) — guarded by
 * `PatientAuthGuard`, NEVER `AuthGuard`. Mixing the two principal types on
 * one route is the failure mode most likely to leak data across the
 * org/patient boundary. The lead/org ids come from the VALIDATED session
 * (`@CurrentPatient()`), never from the client.
 */
@Controller('patient/consent-forms')
@UseGuards(PatientAuthGuard)
export class PatientConsentFormsController {
  @Get()
  @UsePipes(new ValidationPipe({ transform: true }))
  async findAll(
    @CurrentPatient() patient: PatientPrincipal,
    @Query() dto: ListPatientConsentFormsDto
  ) {
    const result = await listPatientConsentForms(db, {
      leadId: patient.leadId,
      organizationId: patient.organizationId,
      status: dto.status,
    });

    if (!result.success) {
      throw this.mapErrorToHttpException(result.error);
    }

    return result.data;
  }

  @Get(':id')
  async findOne(
    @CurrentPatient() patient: PatientPrincipal,
    @Param('id') id: string
  ) {
    const result = await getPatientConsentForm(db, {
      leadId: patient.leadId,
      organizationId: patient.organizationId,
      submissionId: id,
    });

    if (!result.success) {
      throw this.mapErrorToHttpException(result.error);
    }

    return result.data;
  }

  /** Presigned download of the signed-form PDF (generated on demand). */
  @Get(':id/pdf')
  async downloadPdf(
    @CurrentPatient() patient: PatientPrincipal,
    @Param('id') id: string
  ) {
    const result = await getConsentPdfDownloadForPatient(db, {
      submissionId: id,
      leadId: patient.leadId,
      organizationId: patient.organizationId,
    });

    if (!result.success) {
      throw this.mapErrorToHttpException(result.error);
    }

    return result.data;
  }

  @Post(':id/sign')
  @UsePipes(new ValidationPipe({ transform: true }))
  async sign(
    @CurrentPatient() patient: PatientPrincipal,
    @Param('id') id: string,
    @Body() dto: SignConsentFormDto,
    @Req() req: PatientRequest
  ) {
    const result = await signConsentForm(db, {
      leadId: patient.leadId,
      organizationId: patient.organizationId,
      submissionId: id,
      fieldData: dto.fieldData,
      signedByName: dto.signedByName,
      attested: dto.attested,
      signatureImageDataUrl: dto.signatureImageDataUrl,
      // Audit-trail IP: the real (Fly-Client-IP) signer address, never the body.
      signedIp: getClientIp(req),
    });

    if (!result.success) {
      throw this.mapErrorToHttpException(result.error);
    }

    return result.data;
  }

  private mapErrorToHttpException(error: { code: string; message: string }) {
    switch (error.code) {
      case ErrorCodes.VALIDATION_ERROR:
      case ErrorCodes.INVALID_INPUT:
        return new HttpException(error.message, HttpStatus.BAD_REQUEST);
      case ErrorCodes.UNAUTHORIZED:
        return new HttpException(error.message, HttpStatus.UNAUTHORIZED);
      case ErrorCodes.FORBIDDEN:
        return new HttpException(error.message, HttpStatus.FORBIDDEN);
      case ErrorCodes.NOT_FOUND:
        return new HttpException(error.message, HttpStatus.NOT_FOUND);
      case ErrorCodes.CONFLICT:
        return new HttpException(error.message, HttpStatus.CONFLICT);
      default:
        return new HttpException(
          error.message || 'Internal server error',
          HttpStatus.INTERNAL_SERVER_ERROR
        );
    }
  }
}
