// @borradh-workspace/api-client - Error utilities

import type { ApiError } from './types.js';

/**
 * Custom error class for API errors
 * Extends Error with additional API-specific information
 */
export class ApiClientError extends Error {
  /** HTTP status code */
  public readonly status: number;
  /** Error code from the API */
  public readonly code?: string;
  /** Additional error details */
  public readonly details?: Record<string, unknown>;

  constructor(error: ApiError) {
    super(error.message);
    this.name = 'ApiClientError';
    this.status = error.status;
    this.code = error.code;
    this.details = error.details;

    // Maintains proper stack trace (V8 engines)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, ApiClientError);
    }
  }

  /**
   * Convert to plain object for logging/serialization
   */
  toJSON(): ApiError {
    return {
      status: this.status,
      message: this.message,
      code: this.code,
      details: this.details,
    };
  }
}

/**
 * Check if an error is an ApiClientError
 */
export function isApiClientError(error: unknown): error is ApiClientError {
  return error instanceof ApiClientError;
}

/**
 * Check if error is a network error (no response)
 */
export function isNetworkError(error: unknown): boolean {
  return error instanceof TypeError && error.message === 'Failed to fetch';
}

/**
 * Check if error is a timeout error
 */
export function isTimeoutError(error: unknown): boolean {
  if (error instanceof Error) {
    return error.name === 'TimeoutError' || error.message.includes('timeout');
  }
  return false;
}

/**
 * Meta error details shape attached to API errors via the `details.metaError` field.
 * This is set by the backend when a Meta API error occurs.
 */
export interface MetaErrorDetail {
  errorKey: string;
  category: string;
  userTitle: string;
  userMessage: string;
  actionUrl?: string;
  actionLabel?: string;
  videoGuideSlug?: string;
  retryable: boolean;
}

/**
 * Extract Meta error details from any error thrown by the API client.
 * Returns undefined if the error doesn't contain Meta error info.
 *
 * Works with ky's HTTPError (which has `.code` and `.details` attached
 * by the beforeError hook) and ApiClientError instances.
 */
export function getMetaErrorDetail(
  error: unknown
): MetaErrorDetail | undefined {
  if (!error || typeof error !== 'object') return undefined;

  // Check for details.metaError on either error type
  const details = (error as Record<string, unknown>).details as
    | Record<string, unknown>
    | undefined;
  if (details?.metaError && typeof details.metaError === 'object') {
    return details.metaError as MetaErrorDetail;
  }

  return undefined;
}

/**
 * Async version of getMetaErrorDetail that also reads the response body
 * from ky HTTPError objects. Use this when the synchronous version returns
 * undefined — the error's `.details` property may not have been attached
 * if the beforeError hook's body read was skipped or failed.
 */
export async function getMetaErrorDetailAsync(
  error: unknown
): Promise<MetaErrorDetail | undefined> {
  // Try the synchronous check first
  const sync = getMetaErrorDetail(error);
  if (sync) return sync;

  // Fallback: read the response body directly from ky's HTTPError
  if (
    error &&
    typeof error === 'object' &&
    'response' in error &&
    (error as Record<string, unknown>).response instanceof Response
  ) {
    try {
      const response = (error as { response: Response }).response;
      const body = (await response.clone().json()) as Record<string, unknown>;
      const bodyDetails = body.details as Record<string, unknown> | undefined;
      if (bodyDetails?.metaError && typeof bodyDetails.metaError === 'object') {
        return bodyDetails.metaError as MetaErrorDetail;
      }
    } catch {
      // Response not JSON or already consumed
    }
  }

  return undefined;
}
