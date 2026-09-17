/**
 * Structured error class for Meta/Facebook Graph API errors.
 *
 * Parses the standard Meta error response format:
 * { error: { message, type, code, error_subcode, fbtrace_id, error_user_msg } }
 *
 * Classifies errors into actionable categories so callers can decide
 * whether to mark an integration as needs_reconnect, retry, or surface
 * a user-friendly message.
 */

import {
  type MetaErrorCategory,
  type MetaErrorInfo,
  lookupMetaError,
} from './meta-error-registry.js';

// Re-export category type (consumers may still import from here)
export type { MetaErrorCategory };

// Keep the old union type as an alias for backward compatibility with existing code
// that checks `error.category === 'unknown'` etc.
export type MetaApiErrorCategory = MetaErrorCategory;

export interface MetaErrorResponse {
  error?: {
    message?: string;
    type?: string;
    code?: number;
    error_subcode?: number;
    fbtrace_id?: string;
    error_user_msg?: string;
    error_user_title?: string;
  };
}

/**
 * Classify a Meta error using the registry.
 * Falls back to 'unknown' if no match is found.
 */
function classifyMetaError(
  code?: number,
  subcode?: number,
  message?: string
): MetaErrorCategory {
  const info = lookupMetaError(code, subcode, message);
  return info?.category ?? 'unknown';
}

export class MetaApiError extends Error {
  readonly code?: number;
  readonly subcode?: number;
  readonly category: MetaApiErrorCategory;
  readonly fbtrace_id?: string;
  readonly userMessage?: string;
  readonly userTitle?: string;
  readonly type?: string;
  /** Structured error info from the registry (if matched) */
  readonly errorInfo?: MetaErrorInfo;

  constructor(errorResponse: MetaErrorResponse, fallbackMessage?: string) {
    const err = errorResponse.error;
    const message =
      err?.error_user_msg ||
      err?.message ||
      fallbackMessage ||
      'Meta API request failed';
    const code = err?.code;
    const subcode = err?.error_subcode;

    // Build a descriptive message with code info
    const fullMessage = [
      `Meta API Error: ${message}`,
      code !== undefined ? `(code: ${code})` : null,
      subcode !== undefined ? `(subcode: ${subcode})` : null,
    ]
      .filter(Boolean)
      .join(' ');

    super(fullMessage);
    this.name = 'MetaApiError';
    this.code = code;
    this.subcode = subcode;
    this.errorInfo = lookupMetaError(code, subcode, message);
    this.category =
      this.errorInfo?.category ?? classifyMetaError(code, subcode, message);
    this.fbtrace_id = err?.fbtrace_id;
    this.userMessage = err?.error_user_msg;
    this.userTitle = err?.error_user_title;
    this.type = err?.type;
  }

  /** Whether this error means the user needs to reconnect their account */
  get isAuthError(): boolean {
    return this.category === 'auth_required';
  }

  /** Whether this error is due to missing permissions/scopes */
  get isPermissionError(): boolean {
    return this.category === 'permission_denied';
  }

  /** Whether this error is a rate limit */
  get isRateLimited(): boolean {
    return this.category === 'rate_limited';
  }

  /**
   * Whether this is an expected, non-bug condition driven by the user, the
   * recipient, or Meta's policy — not a fault in our system. These are
   * surfaced to the org through other channels (e.g. `needs_reconnect`) and
   * should be logged at `warn`, not `error`, so they don't trip infra error
   * alerts. `transient`, `rate_limited`, and `unknown` stay at `error` level
   * because they may indicate a real problem worth watching.
   */
  get isExpected(): boolean {
    switch (this.category) {
      case 'auth_required':
      case 'user_action_required':
      case 'permission_denied':
      case 'messaging_window':
      case 'user_blocked':
      case 'content_error':
      case 'payment_required':
      case 'account_restricted':
      case 'not_found':
      case 'sender_action_rejected':
        return true;
      default:
        return false;
    }
  }
}

/**
 * Check if an error is a Meta API auth error that requires reconnection.
 * Works with both MetaApiError instances and generic Error objects
 * (e.g., from publish-social-post which does inline fetch).
 */
export function isMetaAuthError(error: unknown): boolean {
  if (error instanceof MetaApiError) {
    return error.isAuthError;
  }

  // Delegate to the registry for generic Error objects
  const info = getMetaErrorInfo(error);
  return info?.category === 'auth_required';
}

/**
 * Extract the best user-facing error message from a Meta API error.
 * Prefers `userMessage` (Meta's error_user_msg) over the technical message.
 * Falls back to `error.message` for non-Meta errors.
 */
export function getMetaErrorMessage(error: unknown): string {
  if (error instanceof MetaApiError) {
    return error.userMessage || error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return 'Unknown error';
}

/**
 * Get structured error info from any error (MetaApiError or generic Error).
 * Returns undefined if the error doesn't match any registry entry.
 */
export function getMetaErrorInfo(error: unknown): MetaErrorInfo | undefined {
  if (error instanceof MetaApiError) {
    return error.errorInfo;
  }

  // For generic errors, try message-based matching
  if (error instanceof Error) {
    return lookupMetaError(undefined, undefined, error.message);
  }

  return undefined;
}

/**
 * Parse a fetch Response into a MetaApiError.
 * Use this in places that make direct fetch calls to Meta APIs.
 */
export async function parseMetaErrorResponse(
  response: Response,
  fallbackMessage?: string
): Promise<MetaApiError> {
  let rawBody: string | undefined;
  try {
    rawBody = await response.text();
    const body = JSON.parse(rawBody) as MetaErrorResponse;
    return new MetaApiError(
      body,
      `${fallbackMessage || 'Meta API request failed'} (HTTP ${response.status})`
    );
  } catch {
    return new MetaApiError(
      {},
      `${fallbackMessage || 'Meta API request failed'} (HTTP ${response.status}${rawBody ? `, body: ${rawBody.slice(0, 200)}` : ''})`
    );
  }
}

/**
 * Extract structured context from a caught error for use in logError extra fields.
 * Enriches log entries with Meta-specific fields when the error is a MetaApiError.
 */
export function extractMetaErrorContext(
  error: unknown
): Record<string, unknown> {
  if (error instanceof MetaApiError) {
    return {
      metaErrorCode: error.code,
      metaSubcode: error.subcode,
      metaCategory: error.category,
      metaFbtraceId: error.fbtrace_id,
      metaType: error.type,
      metaUserMessage: error.userMessage,
    };
  }
  return {};
}
