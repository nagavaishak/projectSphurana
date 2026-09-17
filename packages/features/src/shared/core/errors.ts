/**
 * Base error class with rich context for feature errors
 */
export class FeatureError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly details?: Record<string, unknown>,
    public override readonly cause?: Error
  ) {
    super(message);
    this.name = 'FeatureError';

    // Maintains proper stack trace for where error was thrown (V8 engines)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, FeatureError);
    }
  }

  /**
   * Convert to API-friendly JSON format
   */
  toJSON() {
    return {
      code: this.code,
      message: this.message,
      details: this.details,
    };
  }
}

/**
 * Result type for predictable error handling
 * Use this instead of throwing errors for expected failure cases
 */
export type Result<T, E = FeatureError> =
  | { success: true; data: T }
  | { success: false; error: E };

/**
 * Helper to create a success result
 *
 * @example
 * ```ts
 * return ok(user);
 * ```
 */
export const ok = <T>(data: T): Result<T, never> => ({
  success: true,
  data,
});

/**
 * Helper to create an error result
 *
 * @example
 * ```ts
 * return err(new FeatureError('USER_NOT_FOUND', 'User not found'));
 * ```
 */
export const err = <E = FeatureError>(error: E): Result<never, E> => ({
  success: false,
  error,
});

/**
 * Type helper to extract the success data type from a Result
 *
 * @example
 * ```ts
 * type UserData = ExtractData<Awaited<ReturnType<typeof createUser>>>;
 * ```
 */
export type ExtractData<T> = T extends { success: true; data: infer D }
  ? D
  : never;

/**
 * Type helper to extract the error type from a Result
 */
export type ExtractError<T> = T extends { success: false; error: infer E }
  ? E
  : never;

/**
 * Common error codes used across features
 */
export const ErrorCodes = {
  // Validation errors
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  INVALID_INPUT: 'INVALID_INPUT',

  // Resource errors
  NOT_FOUND: 'NOT_FOUND',
  ALREADY_EXISTS: 'ALREADY_EXISTS',
  CONFLICT: 'CONFLICT',
  INVALID_STATE: 'INVALID_STATE',

  // Authorization errors
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',

  /**
   * A capability the caller asked for is not configured on this deployment
   * (e.g. the CDN is switched off). NOT the same as FORBIDDEN — the caller is
   * allowed, the feature simply isn't wired up here — and it must not share
   * FORBIDDEN's 403, which the frontend reads as a permission failure.
   */
  NOT_CONFIGURED: 'NOT_CONFIGURED',

  // Database errors
  DATABASE_ERROR: 'DATABASE_ERROR',
  TRANSACTION_FAILED: 'TRANSACTION_FAILED',

  // External service errors
  EXTERNAL_SERVICE_ERROR: 'EXTERNAL_SERVICE_ERROR',
  TIMEOUT: 'TIMEOUT',
  RATE_LIMITED: 'RATE_LIMITED',

  // AI generation errors (Track 19)
  NO_AI_ELIGIBLE_TEMPLATES: 'NO_AI_ELIGIBLE_TEMPLATES',
  RETRIEVAL_EMPTY: 'RETRIEVAL_EMPTY',
  AI_VALIDATION_FAILED: 'AI_VALIDATION_FAILED',
  AI_RATE_LIMITED: 'AI_RATE_LIMITED',
  AI_MODEL_REFUSED: 'AI_MODEL_REFUSED',
  COST_CAP_EXCEEDED: 'COST_CAP_EXCEEDED',
  TEMPLATE_NOT_AI_ELIGIBLE: 'TEMPLATE_NOT_AI_ELIGIBLE',

  // Generic errors
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  UNKNOWN_ERROR: 'UNKNOWN_ERROR',
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];

/**
 * Detect a Postgres exclusion-constraint violation (SQLSTATE 23P01), optionally
 * for a specific constraint name. Used to turn a lost double-booking race (the
 * `appointment_no_overlap` GiST exclusion constraint firing on a concurrent
 * INSERT) into a clean CONFLICT rather than a 500. Drizzle wraps the driver
 * error, so we walk the `cause` chain.
 */
export const isExclusionViolation = (
  error: unknown,
  constraintName?: string
): boolean => {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current; depth++) {
    const e = current as {
      code?: string;
      constraint_name?: string;
      constraint?: string;
      cause?: unknown;
    };
    if (e.code === '23P01') {
      const name = e.constraint_name ?? e.constraint;
      if (!constraintName || name === constraintName) return true;
    }
    current = e.cause;
  }
  return false;
};

/**
 * Create a sanitized internal error result.
 * Use this in catch blocks to avoid exposing internal error details to clients.
 * The original error is preserved in the `cause` property for server-side logging.
 *
 * @param fallbackMessage - User-friendly message to show (default: generic message)
 * @param error - The caught error (preserved in cause for logging)
 */
export const internalError = (
  fallbackMessage = 'An unexpected error occurred. Please try again.',
  error?: unknown
): Result<never, FeatureError> =>
  err(
    new FeatureError(
      ErrorCodes.INTERNAL_ERROR,
      fallbackMessage,
      undefined,
      error instanceof Error ? error : undefined
    )
  );
