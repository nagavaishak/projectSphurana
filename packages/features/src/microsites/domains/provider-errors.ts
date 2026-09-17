/**
 * Provider error → `FeatureError`.
 *
 * The port reports a small, provider-independent set of codes; this is the one
 * place they become HTTP-shaped. Keeping the mapping here (rather than a
 * `catch`-all INTERNAL_ERROR at each call site) is what stops a tenant typing
 * someone else's domain from getting a 500 instead of a conflict.
 *
 * The `Record<DomainProviderErrorCode, ...>` type is deliberate: adding a code
 * to the port breaks this file at compile time rather than silently falling
 * through to INTERNAL_ERROR.
 */

import type { DomainProviderErrorCode } from '@borradh-workspace/integrations/domains';
import {
  type ErrorCode,
  ErrorCodes,
  FeatureError,
} from '../../shared/index.js';

const CODE_MAP: Record<DomainProviderErrorCode, ErrorCode> = {
  INVALID_DOMAIN: ErrorCodes.VALIDATION_ERROR,
  // Someone else's domain. CONFLICT, not FORBIDDEN — the caller has permission,
  // the resource is taken.
  DOMAIN_CLAIMED: ErrorCodes.CONFLICT,
  NOT_FOUND: ErrorCodes.NOT_FOUND,
  // The deployment has no domain provider wired up. Distinct from FORBIDDEN,
  // which the frontend reads as a permission failure.
  NOT_CONFIGURED: ErrorCodes.NOT_CONFIGURED,
  RATE_LIMITED: ErrorCodes.RATE_LIMITED,
  PROVIDER_ERROR: ErrorCodes.EXTERNAL_SERVICE_ERROR,
};

export const toDomainFeatureError = (error: {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}): FeatureError =>
  new FeatureError(
    CODE_MAP[error.code as DomainProviderErrorCode] ??
      ErrorCodes.EXTERNAL_SERVICE_ERROR,
    error.message,
    error.details
  );
