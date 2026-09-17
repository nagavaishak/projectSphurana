import {
  getActiveFlags,
  getCurrentOrganizationId,
  getCurrentUserId,
  getCurrentUserSetProps,
} from './context.js';
import {
  type TrackEventOptions,
  isPostHogInitialized,
  trackEvent,
} from './posthog/index.js';
import {
  addBreadcrumb,
  captureException,
  isSentryInitialized,
  logError,
} from './sentry/index.js';

export interface TrackedOptions {
  /** User ID for PostHog tracking */
  userId?: string;
  /** Additional properties to include in tracking */
  properties?: Record<string, string | number | boolean | null | undefined>;
  /** Tags for Sentry context */
  tags?: Record<string, string>;
  /** Whether to track success events (default: true for writes, false for reads) */
  trackSuccess?: boolean;
  /** Whether to track failure events (default: true) */
  trackFailure?: boolean;
}

export interface TrackedResult<T> {
  success: boolean;
  data?: T;
  error?: Error;
  durationMs: number;
}

/**
 * Returns `{ feature_flag_key: '<key>' }` when exactly one flag is active in
 * the current ALS context, or `{ feature_flag_keys: ['a','b'] }` for multiple,
 * or `{}` when no flag scope is active. The guardrail queries by the singular
 * `feature_flag_key` property; the plural is a supplementary signal.
 */
const activeFlagProps = (): Record<string, unknown> => {
  const flags = getActiveFlags();
  if (flags.length === 0) return {};
  if (flags.length === 1) return { feature_flag_key: flags[0] };
  return { feature_flag_key: flags[0], feature_flag_keys: flags };
};

/**
 * PostHog options for a wrapper event.
 *
 * - Attributes the event to the ambient request's `organization` group (when
 *   one is set) so usage rolls up per org — the group key is the DB org id.
 * - Emits **person-less** when there is no acting app user: the `'anonymous'`
 *   fallback from {@link getCurrentUserId}, OR when the distinct id is the org
 *   id itself (system / org-scoped events). This stops nameless `anonymous`
 *   and org-id person profiles from being created.
 * - Otherwise `$set`s the acting user's email/name from context so the person
 *   is named from their own events (no extra `$identify`).
 */
const personOptions = (userId: string): TrackEventOptions => {
  const organizationId = getCurrentOrganizationId();
  const groups = organizationId ? { organization: organizationId } : undefined;

  const isSystemActor =
    userId === 'anonymous' ||
    (organizationId !== undefined && userId === organizationId);

  return isSystemActor
    ? { personless: true, groups }
    : { set: getCurrentUserSetProps(), groups };
};

/**
 * Wrapper function that automatically handles observability for any async operation.
 *
 * Features:
 * - Tracks execution time
 * - Captures errors to Sentry
 * - Sends success/failure events to PostHog
 * - Adds breadcrumbs for debugging
 *
 * @example
 * ```ts
 * const result = await tracked(
 *   'users.createUser',
 *   () => createUserImpl(db, input),
 *   { userId: input.email, properties: { plan: 'free' } }
 * );
 * ```
 */
export const tracked = async <T>(
  eventName: string,
  fn: () => Promise<T>,
  options: TrackedOptions = {}
): Promise<T> => {
  const {
    userId = getCurrentUserId(),
    properties = {},
    tags = {},
    trackSuccess = true,
    trackFailure = true,
  } = options;

  const startTime = Date.now();

  // Add breadcrumb for debugging
  if (isSentryInitialized()) {
    addBreadcrumb({
      message: `Starting: ${eventName}`,
      category: 'feature',
      level: 'info',
      data: { ...properties },
    });
  }

  try {
    const result = await fn();
    const durationMs = Date.now() - startTime;

    // Track success in PostHog
    if (trackSuccess && isPostHogInitialized()) {
      trackEvent(
        userId,
        `${eventName}.success`,
        {
          ...activeFlagProps(),
          ...properties,
          duration_ms: durationMs,
        },
        personOptions(userId)
      );
    }

    // Add success breadcrumb
    if (isSentryInitialized()) {
      addBreadcrumb({
        message: `Completed: ${eventName}`,
        category: 'feature',
        level: 'info',
        data: { duration_ms: durationMs },
      });
    }

    return result;
  } catch (error) {
    const durationMs = Date.now() - startTime;
    const err = error instanceof Error ? error : new Error(String(error));

    // Capture exception in Sentry
    if (isSentryInitialized()) {
      captureException(err, {
        tags: {
          feature: eventName,
          ...tags,
        },
        extra: {
          ...activeFlagProps(),
          ...properties,
          duration_ms: durationMs,
        },
        user: userId !== 'anonymous' ? { id: userId } : undefined,
      });
    }

    // Track failure in PostHog
    if (trackFailure && isPostHogInitialized()) {
      trackEvent(
        userId,
        `${eventName}.error`,
        {
          ...activeFlagProps(),
          ...properties,
          duration_ms: durationMs,
          error_message: err.message,
          error_name: err.name,
        },
        personOptions(userId)
      );
    }

    // Re-throw the error so the caller can handle it
    throw error;
  }
};

/**
 * Wrapper that returns a Result-like object instead of throwing.
 * Useful when you want to handle errors without try/catch.
 *
 * @example
 * ```ts
 * const result = await trackedSafe('users.createUser', () => createUserImpl(db, input));
 * if (!result.success) {
 *   console.error('Failed:', result.error);
 * }
 * ```
 */
export const trackedSafe = async <T>(
  eventName: string,
  fn: () => Promise<T>,
  options: TrackedOptions = {}
): Promise<TrackedResult<T>> => {
  const startTime = Date.now();

  try {
    const data = await tracked(eventName, fn, options);
    return {
      success: true,
      data,
      durationMs: Date.now() - startTime,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error : new Error(String(error)),
      durationMs: Date.now() - startTime,
    };
  }
};

/**
 * Result type shape for trackedResult compatibility.
 * Matches the Result<T> pattern from features package.
 * Uses discriminated union for proper type narrowing.
 */
export type ResultShape<T> =
  | { success: true; data: T; error?: undefined }
  | {
      success: false;
      data?: undefined;
      error: {
        code: string;
        message: string;
        details?: Record<string, unknown>;
      };
    };

/**
 * Error codes that indicate an unexpected/internal failure (as opposed to
 * expected conditions like NOT_FOUND or UNAUTHORIZED). Used by the
 * `internalErrorsOnly` option to decide whether a Result failure should be
 * tracked as an error event.
 */
const INTERNAL_ERROR_CODES = new Set([
  'INTERNAL_ERROR',
  'DATABASE_ERROR',
  'EXTERNAL_SERVICE_ERROR',
  'UNKNOWN_ERROR',
]);

export interface TrackedResultOptions<T = unknown> extends TrackedOptions {
  /**
   * When true, only log INTERNAL_ERROR failures, not expected errors like
   * UNAUTHORIZED, NOT_FOUND, VALIDATION_ERROR, etc.
   * Useful for endpoints where non-success results are expected (e.g., auth checks).
   */
  internalErrorsOnly?: boolean;

  /**
   * Extra properties derived from the RESULT, merged into the `.success` event.
   *
   * `properties` is evaluated before the call, so it can only ever describe the
   * INPUT. That is a real blind spot for any service whose success payload
   * carries the outcome: `ok({ sent: false, reason })` is a successful Result,
   * so `.success` fires either way and the event cannot say which happened.
   * `sendLeadFirstTouch` is the case in point — "did the lead actually get a
   * message" was unanswerable from PostHog and had to be queried out of the
   * production database.
   *
   * Runs only on success, and only when tracking is on. Throwing here must not
   * fail the operation, so it is caught and ignored — telemetry never breaks
   * the thing it measures.
   */
  resultProperties?: (
    data: T
  ) => Record<string, string | number | boolean | null | undefined>;
}

/**
 * Wrapper for functions returning Result<T> that automatically logs errors.
 * Unlike tracked(), this inspects the Result and logs failures without throwing.
 *
 * Features:
 * - Logs Result errors to console and Sentry
 * - Catches and logs thrown exceptions
 * - Configurable logging (can disable for expected errors like UNAUTHORIZED)
 * - Tracks execution time
 *
 * @example
 * ```ts
 * // Instead of:
 * export const signUp = (authApi, input) =>
 *   tracked('auth.signUp', () => signUpImpl(authApi, input));
 *
 * // Use:
 * export const signUp = (authApi, input) =>
 *   trackedResult('auth.signUp', () => signUpImpl(authApi, input), {
 *     properties: { email: input.email },
 *   });
 * ```
 */
/** Read-operation prefixes that don't need PostHog success events */
const READ_PREFIXES =
  /\.(get|list|check|find|search|fetch|verify|validate|export|suggest)/i;

export const trackedResult = async <T>(
  eventName: string,
  fn: () => Promise<ResultShape<T>>,
  options: TrackedResultOptions<T> = {}
): Promise<ResultShape<T>> => {
  const isReadOp = READ_PREFIXES.test(eventName);
  const {
    userId = getCurrentUserId(),
    properties = {},
    trackSuccess = !isReadOp,
    trackFailure = true,
    internalErrorsOnly = false,
    resultProperties,
  } = options;

  const startTime = Date.now();
  const feature = eventName.split('.')[0];

  // Add breadcrumb for debugging
  if (isSentryInitialized()) {
    addBreadcrumb({
      message: `Starting: ${eventName}`,
      category: 'feature',
      level: 'info',
      data: { ...properties },
    });
  }

  try {
    const result = await fn();
    const durationMs = Date.now() - startTime;

    if (result.success) {
      // Track success in PostHog
      if (trackSuccess && isPostHogInitialized()) {
        // Telemetry must never break the operation it describes, so a throwing
        // deriver costs its properties and nothing else.
        let derived: Record<
          string,
          string | number | boolean | null | undefined
        > = {};
        if (resultProperties) {
          try {
            derived = resultProperties(result.data);
          } catch {
            /* ignore */
          }
        }
        trackEvent(
          userId,
          `${eventName}.success`,
          {
            ...activeFlagProps(),
            ...properties,
            ...derived,
            duration_ms: durationMs,
          },
          personOptions(userId)
        );
      }

      // Add success breadcrumb
      if (isSentryInitialized()) {
        addBreadcrumb({
          message: `Completed: ${eventName}`,
          category: 'feature',
          level: 'info',
          data: { duration_ms: durationMs },
        });
      }
    } else {
      // Result indicates failure - add breadcrumb for debugging
      // Note: Detailed error logging should be done in the service using logError()
      if (isSentryInitialized()) {
        const errorCode = result.error?.code ?? 'UNKNOWN_ERROR';
        addBreadcrumb({
          message: `Failed: ${eventName} (${errorCode})`,
          category: 'feature',
          level: 'warning',
          data: { duration_ms: durationMs, code: errorCode },
        });
      }

      // Track failure in PostHog.
      // When internalErrorsOnly is set, expected error codes (NOT_FOUND,
      // UNAUTHORIZED, CONFLICT, ...) are not tracked as errors - only
      // unexpected/internal failures are. The Sentry breadcrumb above is
      // always kept for debugging.
      const errorCode = result.error?.code ?? 'UNKNOWN_ERROR';
      const isInternalError = INTERNAL_ERROR_CODES.has(errorCode);
      if (
        trackFailure &&
        (!internalErrorsOnly || isInternalError) &&
        isPostHogInitialized()
      ) {
        trackEvent(
          userId,
          `${eventName}.error`,
          {
            ...activeFlagProps(),
            ...properties,
            duration_ms: durationMs,
            error_code: errorCode,
          },
          personOptions(userId)
        );
      }
    }

    return result;
  } catch (error) {
    // Unexpected exception - log using unified logger
    logError(eventName, error, {
      feature,
      extra: { ...properties },
    });

    // Track failure in PostHog
    if (trackFailure && isPostHogInitialized()) {
      const err = error instanceof Error ? error : new Error(String(error));
      trackEvent(
        userId,
        `${eventName}.exception`,
        {
          ...activeFlagProps(),
          ...properties,
          error_message: err.message,
          error_name: err.name,
        },
        personOptions(userId)
      );
    }

    const err = error instanceof Error ? error : new Error(String(error));

    // Enrich details with the error cause (drizzle wraps the real
    // PostgresError in err.cause - surface its message and pg fields).
    const causeDetails: Record<string, unknown> = {};
    if (err.cause instanceof Error) {
      causeDetails.causeMessage = err.cause.message;
      const pg = err.cause as unknown as Record<string, unknown>;
      if (pg.code) causeDetails.dbCode = pg.code;
      if (pg.detail) causeDetails.dbDetail = pg.detail;
      if (pg.constraint_name) causeDetails.dbConstraint = pg.constraint_name;
    }

    // Return as error Result instead of throwing
    return {
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred. Please try again.',
        details: { originalError: err.message, ...causeDetails },
      },
    };
  }
};
