import { ErrorCodes } from '../../shared/index.js';

/**
 * User-specific error codes
 */
export const UserErrorCodes = {
  ...ErrorCodes,
  USER_NOT_FOUND: 'USER_NOT_FOUND',
  USER_ALREADY_EXISTS: 'USER_ALREADY_EXISTS',
  USER_INACTIVE: 'USER_INACTIVE',
  INVALID_USER_STATUS: 'INVALID_USER_STATUS',
} as const;

export type UserErrorCode =
  (typeof UserErrorCodes)[keyof typeof UserErrorCodes];
