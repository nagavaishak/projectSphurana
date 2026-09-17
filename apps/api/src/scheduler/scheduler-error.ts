import { createLogger, logError } from '@borradh-workspace/observability';

const logger = createLogger('scheduler');

/**
 * Shape of the error carried on a failed feature `Result`. Matches the
 * downgraded `{ code, message, details }` that `trackedResult` produces.
 */
interface SchedulerResultError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
  cause?: Error;
}

/**
 * Postgres SQLSTATEs that mean "this process's credentials or target database
 * are wrong", not "this query failed". They cannot recover on their own: the
 * connection string is fixed at boot, so every subsequent tick fails the same
 * way until the app is redeployed with a new one.
 *
 * @see https://www.postgresql.org/docs/current/errcodes-appendix.html
 */
const UNRECOVERABLE_DB_CODES = new Set([
  '28P01', // invalid_password
  '28000', // invalid_authorization_specification
  '3D000', // invalid_catalog_name
]);

/**
 * Operations that have already reported an unrecoverable credential failure in
 * this process. Deliberately unbounded-but-tiny: bounded by the number of
 * scheduler operations, which is a fixed handful.
 */
const reportedCredentialFailures = new Set<string>();

/** Test seam — schedulers are singletons, so the set never resets in prod. */
export function resetCredentialFailureSuppression(): void {
  reportedCredentialFailures.clear();
}

function unrecoverableDbCode(error: SchedulerResultError): string | undefined {
  const code = error.details?.dbCode;
  return typeof code === 'string' && UNRECOVERABLE_DB_CODES.has(code)
    ? code
    : undefined;
}

/**
 * Log a scheduler job's failed `Result` while surfacing the REAL underlying
 * cause instead of a blanket INTERNAL_ERROR.
 *
 * Why: when a feature impl throws, `trackedResult` catches it, logs the real
 * error, and returns `{ code: 'INTERNAL_ERROR', message: 'An unexpected error
 * occurred. Please try again.', details: { originalError } }`. Schedulers used
 * to re-log `new Error(result.error.message)` — i.e. the generic masked
 * message — so every cron failure grouped into one opaque "An unexpected error
 * occurred" Sentry issue (ENG-281, ENG-294). This helper logs the captured
 * `details.originalError` as the message so the Sentry issue carries the real
 * cause, with the error code + details attached as context.
 *
 * Credential failures (see `UNRECOVERABLE_DB_CODES`) are reported ONCE per
 * operation per process and then logged locally only. A scheduler runs on a
 * fixed interval — `handleScheduledPostPublishing` every 60s — so a dead
 * connection string turns into an unbounded stream of identical events that
 * says nothing after the first one. An orphaned preview app that outlived its
 * Neon branch put ~55k of them into the PRODUCTION Sentry project in a week
 * across two issues (API-Q, API-AT), burying the real database errors. The
 * first report still fires, so the alert path is intact.
 */
export function logSchedulerResultError(
  operation: string,
  error: SchedulerResultError,
  extra: Record<string, unknown> = {}
): void {
  const dbCode = unrecoverableDbCode(error);
  if (dbCode) {
    const key = `${operation}:${dbCode}`;
    if (reportedCredentialFailures.has(key)) {
      logger.error(
        `${operation}: database credentials still rejected (${dbCode}) — suppressed after first report; this process needs a redeploy with a valid DATABASE_URL`
      );
      return;
    }
    reportedCredentialFailures.add(key);
  }

  const originalError =
    typeof error.details?.originalError === 'string'
      ? error.details.originalError
      : undefined;

  // Prefer the masked-but-captured real cause; fall back to the Result message
  // for expected (non-INTERNAL_ERROR) failures that carry a meaningful message.
  const message = originalError ?? error.message;

  // Preserve the handled exception so Sentry groups this scheduler event by
  // the actual database/network failure rather than the generic Result text.
  logError(operation, new Error(message, { cause: error.cause }), {
    feature: 'scheduler',
    extra: { code: error.code, ...error.details, ...extra },
  });
}
