import { db } from '@borradh-workspace/database';
import {
  createPatientDocument,
  getPatientDocumentDownloadUrlForPatient,
  listPatientDocumentsForPatient,
  presignPatientDocument,
} from '@borradh-workspace/features/patient-documents';
import { ErrorCodes } from '@borradh-workspace/features/shared';
import {
  attachmentDisposition,
  getMetadata,
  getOrgAssetsBucket,
  getPresignedDownloadUrl,
  getPresignedUploadUrl,
  getPublicAssetsBucket,
  getS3Region,
} from '@borradh-workspace/storage';
import {
  Body,
  Controller,
  Get,
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
  PresignPatientDocumentDto,
  RecordPatientDocumentDto,
} from './dto/index.js';

/**
 * Patient-side document vault (ENG-647 Phase 4) — guarded by
 * `PatientAuthGuard`, NEVER `AuthGuard`. The generic `upload/presigned-url`
 * endpoint is staff-guarded, so the portal presigns here instead: same
 * feature plumbing, but the org/lead ids come from the validated patient
 * session — a patient can only ever presign/record against their own record.
 *
 * Flow: POST presign → browser PUTs the file to S3 → POST / records the row.
 */
@Controller('patient/documents')
@UseGuards(PatientAuthGuard)
export class PatientDocumentsController {
  private readonly presignStorageDeps = {
    getOrgAssetsBucket,
    getPublicAssetsBucket,
    getS3Region,
    getPresignedUploadUrl,
  };

  private readonly recordStorageDeps = {
    getOrgAssetsBucket,
    getS3Region,
    getMetadata,
  };

  private readonly downloadStorageDeps = {
    getOrgAssetsBucket,
    getPresignedDownloadUrl,
    attachmentDisposition,
  };

  @Get()
  async list(@CurrentPatient() patient: PatientPrincipal) {
    const result = await listPatientDocumentsForPatient(db, {
      organizationId: patient.organizationId,
      leadId: patient.leadId,
    });
    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  @Post('presign')
  @UsePipes(new ValidationPipe({ transform: true }))
  async presign(
    @CurrentPatient() patient: PatientPrincipal,
    @Body() dto: PresignPatientDocumentDto
  ) {
    const result = await presignPatientDocument(db, this.presignStorageDeps, {
      ...dto,
      organizationId: patient.organizationId,
      leadId: patient.leadId,
      uploaderId: patient.leadId,
    });
    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  @Get(':id/download')
  async download(
    @CurrentPatient() patient: PatientPrincipal,
    @Param('id') id: string
  ) {
    const result = await getPatientDocumentDownloadUrlForPatient(
      db,
      this.downloadStorageDeps,
      {
        organizationId: patient.organizationId,
        leadId: patient.leadId,
        documentId: id,
      }
    );
    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  @Post()
  @UsePipes(new ValidationPipe({ transform: true }))
  async record(
    @CurrentPatient() patient: PatientPrincipal,
    @Body() dto: RecordPatientDocumentDto
  ) {
    const result = await createPatientDocument(db, this.recordStorageDeps, {
      ...dto,
      organizationId: patient.organizationId,
      leadId: patient.leadId,
      uploadedByType: 'patient',
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
