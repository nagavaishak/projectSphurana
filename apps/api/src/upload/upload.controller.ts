import { ErrorCodes } from '@borradh-workspace/features/shared';
import {
  completeMobileUpload,
  completeMobileUploadSchema,
  completeMultipartUpload,
  completeMultipartUploadSchema,
  createMobileUploadToken,
  createMobileUploadTokenSchema,
  generatePresignedDownloadUrl,
  generatePresignedDownloadUrlSchema,
  generatePresignedUploadUrl,
  generatePresignedUploadUrlSchema,
  getMobileUploadStatus,
  initiateMultipartUpload,
  initiateMultipartUploadSchema,
  signMultipartUploadParts,
  signMultipartUploadPartsSchema,
  verifyMobileUploadToken,
} from '@borradh-workspace/features/upload';
import { getRedis } from '@borradh-workspace/redis';
import {
  completeMultipartUpload as completeMultipartUploadFn,
  createMultipartUpload as createMultipartUploadFn,
  getOrgAssetsBucket,
  getPresignedDownloadUrl as getPresignedDownloadUrlFn,
  getPresignedMultipartUploadPartUrl as getPresignedMultipartUploadPartUrlFn,
  getPresignedUploadUrl as getPresignedUploadUrlFn,
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
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { createZodDto } from 'nestjs-zod';
import {
  ActiveOrganization,
  AuthGuard,
  type AuthenticatedRequest,
  CurrentUser,
  Public,
} from '../common';

// DTOs from feature schemas
export class GetPresignedUploadUrlDto extends createZodDto(
  generatePresignedUploadUrlSchema.omit({ userId: true, organizationId: true })
) {}

export class GetPresignedDownloadUrlDto extends createZodDto(
  generatePresignedDownloadUrlSchema.omit({
    userId: true,
    organizationId: true,
  })
) {}

export class InitiateMultipartUploadDto extends createZodDto(
  initiateMultipartUploadSchema.omit({
    userId: true,
    organizationId: true,
  })
) {}

export class SignMultipartUploadPartsDto extends createZodDto(
  signMultipartUploadPartsSchema.omit({
    userId: true,
    organizationId: true,
  })
) {}

export class CompleteMultipartUploadDto extends createZodDto(
  completeMultipartUploadSchema.omit({
    userId: true,
    organizationId: true,
  })
) {}

export class CreateMobileTokenDto extends createZodDto(
  createMobileUploadTokenSchema.omit({ userId: true, organizationId: true })
) {}

export class CompleteMobileUploadDto extends createZodDto(
  completeMobileUploadSchema.omit({ token: true })
) {}

@Controller('upload')
@UseGuards(AuthGuard)
export class UploadController {
  private readonly storageDeps = {
    getOrgAssetsBucket,
    getPublicAssetsBucket,
    getS3Region,
    getPresignedUploadUrl: getPresignedUploadUrlFn,
  };

  private readonly multipartStorageDeps = {
    getOrgAssetsBucket,
    getPublicAssetsBucket,
    getS3Region,
    createMultipartUpload: createMultipartUploadFn,
    getPresignedMultipartUploadPartUrl: getPresignedMultipartUploadPartUrlFn,
    completeMultipartUpload: completeMultipartUploadFn,
  };

  private readonly downloadStorageDeps = {
    getOrgAssetsBucket,
    getPublicAssetsBucket,
    getPresignedDownloadUrl: getPresignedDownloadUrlFn,
  };

  @Post('presigned-url')
  @UsePipes(new ValidationPipe({ transform: true }))
  async getPresignedUploadUrlEndpoint(
    @CurrentUser() user: AuthenticatedRequest['user'],
    @ActiveOrganization() organizationId: string | undefined,
    @Body() dto: GetPresignedUploadUrlDto
  ) {
    const result = await generatePresignedUploadUrl(this.storageDeps, {
      ...dto,
      userId: user.id,
      organizationId,
    });

    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  @Post('multipart/initiate')
  @UsePipes(new ValidationPipe({ transform: true }))
  async initiateMultipartUploadEndpoint(
    @CurrentUser() user: AuthenticatedRequest['user'],
    @ActiveOrganization() organizationId: string | undefined,
    @Body() dto: InitiateMultipartUploadDto
  ) {
    const result = await initiateMultipartUpload(this.multipartStorageDeps, {
      ...dto,
      userId: user.id,
      organizationId,
    });

    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  @Post('multipart/sign-parts')
  @UsePipes(new ValidationPipe({ transform: true }))
  async signMultipartUploadPartsEndpoint(
    @CurrentUser() user: AuthenticatedRequest['user'],
    @ActiveOrganization() organizationId: string | undefined,
    @Body() dto: SignMultipartUploadPartsDto
  ) {
    const result = await signMultipartUploadParts(this.multipartStorageDeps, {
      ...dto,
      userId: user.id,
      organizationId,
    });

    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  @Post('multipart/complete')
  @UsePipes(new ValidationPipe({ transform: true }))
  async completeMultipartUploadEndpoint(
    @CurrentUser() user: AuthenticatedRequest['user'],
    @ActiveOrganization() organizationId: string | undefined,
    @Body() dto: CompleteMultipartUploadDto
  ) {
    const result = await completeMultipartUpload(this.multipartStorageDeps, {
      ...dto,
      userId: user.id,
      organizationId,
    });

    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  @Post('presigned-download-url')
  @UsePipes(new ValidationPipe({ transform: true }))
  async getPresignedDownloadUrlEndpoint(
    @CurrentUser() user: AuthenticatedRequest['user'],
    @ActiveOrganization() organizationId: string | undefined,
    @Body() dto: GetPresignedDownloadUrlDto
  ) {
    const result = await generatePresignedDownloadUrl(
      this.downloadStorageDeps,
      {
        ...dto,
        userId: user.id,
        organizationId,
      }
    );

    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  // ─────────────────────────────────────────────────────────────────
  // MOBILE UPLOAD ENDPOINTS
  // ─────────────────────────────────────────────────────────────────

  @Post('mobile-token')
  @UsePipes(new ValidationPipe({ transform: true }))
  async createMobileTokenEndpoint(
    @CurrentUser() user: AuthenticatedRequest['user'],
    @ActiveOrganization() organizationId: string | undefined,
    @Body() dto: CreateMobileTokenDto
  ) {
    if (!organizationId) {
      throw new HttpException(
        'No active organization selected',
        HttpStatus.BAD_REQUEST
      );
    }

    const result = await createMobileUploadToken(
      getRedis(),
      { getOrgAssetsBucket },
      { ...dto, userId: user.id, organizationId }
    );

    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  @Public()
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { ttl: 60_000, limit: 20 } })
  @Get('mobile-verify/:token')
  async verifyMobileTokenEndpoint(@Param('token') token: string) {
    const result = await verifyMobileUploadToken(
      getRedis(),
      { getPresignedUploadUrl: getPresignedUploadUrlFn },
      { token }
    );

    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  @Public()
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { ttl: 60_000, limit: 20 } })
  @Post('mobile-complete/:token')
  async completeMobileUploadEndpoint(@Param('token') token: string) {
    const result = await completeMobileUpload(
      getRedis(),
      { getS3Region },
      { token }
    );

    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  @Get('mobile-status/:videoId')
  async getMobileUploadStatusEndpoint(@Param('videoId') videoId: string) {
    // Note: videoId is a random UUID only known to the user who created the token.
    // Full ownership check would require storing userId in Redis during token creation.
    return getMobileUploadStatus(getRedis(), { videoId });
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
