import { db } from '@borradh-workspace/database';
import {
  assignDocumentImport,
  clearDocumentImports,
  completeDocumentImport,
  discardDocumentImport,
  getDocumentImport,
  listDocumentImports,
  presignDocumentImport,
} from '@borradh-workspace/features/document-imports';
import { ErrorCodes } from '@borradh-workspace/features/shared';
import {
  copy,
  deleteObject,
  getMetadata,
  getOrgAssetsBucket,
  getPresignedUploadUrl,
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
  Query,
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
  AssignDocumentImportDto,
  ListDocumentImportsQueryDto,
  PresignDocumentImportDto,
} from './dto/index.js';

/**
 * Bulk "Import Documents" (ENG-784): stage PDFs/photos, let the matcher file
 * each one against the right client, and let staff resolve the rest.
 *
 * EVERY handler carries an explicit `@RequireRole`. `RoleGuard` is a
 * PASSTHROUGH when a handler declares neither role nor permission metadata
 * (role.guard.ts), so listing it in `@UseGuards` without a per-handler
 * decorator authenticates but does not authorize. Do not add a handler here
 * without one.
 *
 * member — all of it. Staging, reviewing and filing clinical paperwork is
 *          day-to-day front-desk work, and discarding a STAGED file is not
 *          the same act as deleting a vault document (that stays admin-only
 *          on the vault's own controller).
 */
@Controller('document-imports')
@UseGuards(AuthGuard, RoleGuard)
export class DocumentImportsController {
  private readonly presignStorageDeps = {
    getOrgAssetsBucket,
    getPresignedUploadUrl,
  };

  private readonly completeStorageDeps = { getOrgAssetsBucket, getMetadata };

  private readonly finalizeStorageDeps = {
    getOrgAssetsBucket,
    getS3Region,
    getMetadata,
    copy,
    deleteObject,
  };

  private readonly discardStorageDeps = { getOrgAssetsBucket, deleteObject };

  @Get()
  @RequireRole('member')
  @UsePipes(new ValidationPipe({ transform: true }))
  async list(
    @ActiveOrganization() organizationId: string,
    @Query() query: ListDocumentImportsQueryDto
  ) {
    const result = await listDocumentImports(db, {
      organizationId,
      status: query.status,
      limit: query.limit,
    });
    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  @Get(':id')
  @RequireRole('member')
  async findOne(
    @Param('id') importId: string,
    @ActiveOrganization() organizationId: string
  ) {
    const result = await getDocumentImport(db, { organizationId, importId });
    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  @Post('presign')
  @RequireRole('member')
  @UsePipes(new ValidationPipe({ transform: true }))
  async presign(
    @ActiveOrganization() organizationId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: PresignDocumentImportDto
  ) {
    const result = await presignDocumentImport(db, this.presignStorageDeps, {
      ...dto,
      organizationId,
      uploaderId: userId,
    });
    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  @Post(':id/complete')
  @RequireRole('member')
  async complete(
    @Param('id') importId: string,
    @ActiveOrganization() organizationId: string
  ) {
    const result = await completeDocumentImport(db, this.completeStorageDeps, {
      organizationId,
      importId,
    });
    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  @Post(':id/assign')
  @RequireRole('member')
  @UsePipes(new ValidationPipe({ transform: true }))
  async assign(
    @Param('id') importId: string,
    @ActiveOrganization() organizationId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: AssignDocumentImportDto
  ) {
    const result = await assignDocumentImport(db, this.finalizeStorageDeps, {
      organizationId,
      importId,
      leadId: dto.leadId,
      actorUserId: userId,
    });
    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  /**
   * Empty the dialog of everything already dealt with.
   *
   * Declared BEFORE `@Delete(':id')`: Nest matches in declaration order, and
   * a literal path registered after a parameterised one is unreachable —
   * "settled" would be read as an import id.
   */
  @Delete('settled')
  @RequireRole('member')
  async clearSettled(@ActiveOrganization() organizationId: string) {
    const result = await clearDocumentImports(db, this.discardStorageDeps, {
      organizationId,
    });
    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  @Delete(':id')
  @RequireRole('member')
  async discard(
    @Param('id') importId: string,
    @ActiveOrganization() organizationId: string
  ) {
    const result = await discardDocumentImport(db, this.discardStorageDeps, {
      organizationId,
      importId,
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
