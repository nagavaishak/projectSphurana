import { signUploadUrl } from '@borradh-workspace/features/assistant';
import { ErrorCodes } from '@borradh-workspace/features/shared';
import {
  Body,
  Controller,
  HttpException,
  HttpStatus,
  Post,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { ActiveOrganization, AuthGuard, CurrentUser } from '../common/index.js';
// Direct import (not via the dto barrel) to avoid pulling sibling DTOs'
// schemas into this controller's eager-evaluation chain at test time.
import { SignUploadUrlDto } from './dto/sign-upload-url.dto.js';

/**
 * The stable client-facing shape. Internal fields like `bucket` and the S3 key
 * stay server-side; the frontend needs only the two URLs, the media type, the
 * expiry and the size cap it must enforce locally.
 */
function toSignedUploadResponse(data: {
  uploadUrl: string;
  downloadUrl: string;
  mimeType: string;
  expiresAt: Date;
  contentLengthMax: number;
}) {
  return {
    uploadUrl: data.uploadUrl,
    downloadUrl: data.downloadUrl,
    mimeType: data.mimeType,
    expiresAt: data.expiresAt.toISOString(),
    contentLengthMax: data.contentLengthMax,
  };
}

/**
 * Endpoint surface for assistant image attachments.
 *
 * Frontend flow:
 *   1. User selects a file in the AI Elements `attachments` component.
 *   2. Frontend calls `POST /assistant/uploads/sign` with `{ conversationId,
 *      mimeType }`.
 *   3. Backend signs an S3 PUT URL (5 min TTL) + a download URL (1 hr TTL).
 *   4. Frontend uploads directly to S3 with the same Content-Type.
 *   5. Frontend includes the download URL in the `useChat` message as a
 *      `file` part with `mediaType: 'image/...'`.
 *   6. Backend's convert-to-anthropic-messages converts the file part to
 *      an Anthropic image content block referencing the URL.
 *
 * Cross-org isolation: the S3 key is namespaced by the active organization
 * (which the AuthGuard pins to the session); a request can never sign a key
 * under another org's prefix.
 */
@Controller('assistant')
@UseGuards(AuthGuard)
export class UploadsController {
  @Post('uploads/sign')
  @UsePipes(new ValidationPipe({ transform: true }))
  async sign(
    @Body() dto: SignUploadUrlDto,
    @ActiveOrganization() organizationId: string,
    @CurrentUser('id') userId: string
  ) {
    if (!organizationId) {
      throw new HttpException(
        'No active organization selected',
        HttpStatus.BAD_REQUEST
      );
    }
    const result = await signUploadUrl({
      organizationId,
      userId,
      conversationId: dto.conversationId,
      mimeType: dto.mimeType,
    });
    if (!result.success) throw this.mapError(result.error);
    return toSignedUploadResponse(result.data);
  }

  private mapError(error: { code: string; message: string }) {
    switch (error.code) {
      case ErrorCodes.VALIDATION_ERROR:
      case ErrorCodes.INVALID_INPUT:
        return new HttpException(error.message, HttpStatus.BAD_REQUEST);
      case ErrorCodes.UNAUTHORIZED:
        return new HttpException(error.message, HttpStatus.UNAUTHORIZED);
      case ErrorCodes.FORBIDDEN:
        return new HttpException(error.message, HttpStatus.FORBIDDEN);
      default:
        return new HttpException(
          error.message || 'Failed to sign upload URL',
          HttpStatus.INTERNAL_SERVER_ERROR
        );
    }
  }
}
