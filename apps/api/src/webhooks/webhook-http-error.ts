import { ErrorCodes } from '@borradh-workspace/features/shared';
import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * The `FeatureError.code` → HTTP status mapping the webhook controllers were
 * each carrying as a private `mapError`. Lifted out verbatim so the dispatch
 * modules (which now hold the orchestration) can raise the SAME status/message
 * pairs the handlers used to raise.
 */
const STATUS_BY_CODE: Record<string, HttpStatus> = {
  [ErrorCodes.VALIDATION_ERROR]: HttpStatus.BAD_REQUEST,
  [ErrorCodes.UNAUTHORIZED]: HttpStatus.UNAUTHORIZED,
  [ErrorCodes.FORBIDDEN]: HttpStatus.FORBIDDEN,
  [ErrorCodes.NOT_FOUND]: HttpStatus.NOT_FOUND,
  [ErrorCodes.ALREADY_EXISTS]: HttpStatus.CONFLICT,
  [ErrorCodes.CONFLICT]: HttpStatus.CONFLICT,
};

export const webhookHttpError = (error: {
  code: string;
  message: string;
}): HttpException =>
  new HttpException(
    error.message,
    STATUS_BY_CODE[error.code] || HttpStatus.INTERNAL_SERVER_ERROR
  );
