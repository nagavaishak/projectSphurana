import { db } from '@borradh-workspace/database';
import {
  createPatientDocument,
  deletePatientDocument,
  getPatientDocumentDownloadUrlForStaff,
  listPatientDocumentsForStaff,
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
  Delete,
  Get,
  HttpException,
  HttpStatus,
  Param,
  Post,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import {
  ActiveOrganization,
  AuthGuard,
  CurrentUser,
  RequireRole,
  RoleGuard,
} from '../common';
import {
  PresignPatientDocumentDto,
  RecordPatientDocumentDto,
} from './dto/index.js';

/**
 * Staff-side patient document vault (ENG-647 Phase 4): list a lead's
 * documents, upload on the patient's behalf, and soft-delete. Staff-guarded
 * like the rest of the leads surface — the org comes from the active
 * session, and the create service verifies the route lead belongs to it.
 *
 * EVERY handler carries an explicit `@RequireRole`. `RoleGuard` is a
 * PASSTHROUGH when a handler declares neither role nor permission metadata
 * (role.guard.ts), so listing it in `@UseGuards` without a per-handler
 * decorator authenticates but does not authorize. Do not add a handler here
 * without one.
 *
 * member — trusted staff, i.e. practitioners: reading a patient's documents
 *          and adding one on their behalf is day-to-day clinical work.
 * admin  — deletion. It is the one irreversible action here and it changes
 *          what the PATIENT sees in their portal, so it sits a tier above
 *          the reads that surround it.
 */
@Controller('leads/:leadId/documents')
@UseGuards(AuthGuard, RoleGuard)
export class StaffPatientDocumentsController {
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

  @Get(':documentId/download')
  @RequireRole('member')
  async download(
    @Param('leadId') leadId: string,
    @Param('documentId') documentId: string,
    @ActiveOrganization() organizationId: string
  ) {
    const result = await getPatientDocumentDownloadUrlForStaff(
      db,
      this.downloadStorageDeps,
      { organizationId, leadId, documentId }
    );
    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  @Get()
  @RequireRole('member')
  async list(
    @Param('leadId') leadId: string,
    @ActiveOrganization() organizationId: string
  ) {
    const result = await listPatientDocumentsForStaff(db, {
      organizationId,
      leadId,
    });
    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  @Post('presign')
  @RequireRole('member')
  @UsePipes(new ValidationPipe({ transform: true }))
  async presign(
    @Param('leadId') leadId: string,
    @ActiveOrganization() organizationId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: PresignPatientDocumentDto
  ) {
    const result = await presignPatientDocument(db, this.presignStorageDeps, {
      ...dto,
      organizationId,
      leadId,
      uploaderId: userId,
    });
    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  @Post()
  @RequireRole('member')
  @UsePipes(new ValidationPipe({ transform: true }))
  async record(
    @Param('leadId') leadId: string,
    @ActiveOrganization() organizationId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: RecordPatientDocumentDto
  ) {
    const result = await createPatientDocument(db, this.recordStorageDeps, {
      ...dto,
      organizationId,
      leadId,
      uploadedByType: 'staff',
      uploadedByUserId: userId,
    });
    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  @Delete(':documentId')
  @RequireRole('admin')
  async remove(
    @Param('leadId') leadId: string,
    @Param('documentId') documentId: string,
    @ActiveOrganization() organizationId: string
  ) {
    const result = await deletePatientDocument(db, {
      organizationId,
      leadId,
      documentId,
    });
    if (!result.success) throw this.mapError(result.error);
    return { success: true };
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
