import { ErrorCodes } from '@borradh-workspace/features/shared';
import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * Map a feature error to an HTTP exception.
 * Shared by all V1 controllers.
 */
export function mapError(error: {
  code: string;
  message: string;
}): HttpException {
  const map: Record<string, HttpStatus> = {
    [ErrorCodes.VALIDATION_ERROR]: HttpStatus.BAD_REQUEST,
    [ErrorCodes.INVALID_INPUT]: HttpStatus.BAD_REQUEST,
    [ErrorCodes.INVALID_STATE]: HttpStatus.BAD_REQUEST,
    [ErrorCodes.UNAUTHORIZED]: HttpStatus.UNAUTHORIZED,
    [ErrorCodes.FORBIDDEN]: HttpStatus.FORBIDDEN,
    [ErrorCodes.NOT_FOUND]: HttpStatus.NOT_FOUND,
    [ErrorCodes.ALREADY_EXISTS]: HttpStatus.CONFLICT,
    [ErrorCodes.CONFLICT]: HttpStatus.CONFLICT,
  };
  const status = map[error.code] || HttpStatus.INTERNAL_SERVER_ERROR;
  // Never expose internal error details to the client
  const message =
    status >= 500 ? 'An unexpected error occurred' : error.message;
  return new HttpException(message, status);
}
