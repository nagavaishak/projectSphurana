/**
 * Severity-aware logging for Meta API errors.
 *
 * Mirrors `MetaMessagingService.logApiError`: expected, user/recipient-side
 * conditions (dead token → needs_reconnect, deleted lead, blocked recipient,
 * archived conversation, …) are logged at `warn` via the structured Pino
 * logger ONLY — never routed to Sentry — so they don't inflate error-rate
 * alerts. Genuinely unexpected failures (transient/rate-limit/unknown, or
 * non-Meta errors) log at `error`.
 *
 * NOTE: deliberately NOT exported from `shared/index.ts` (and therefore not
 * from the package root). The features-package test mock re-exports the
 * shared surface explicitly; keeping this helper internal to
 * `@borradh-workspace/integrations` avoids widening that contract.
 */
import { createLogger, logError } from '@borradh-workspace/observability';
import { MetaApiError, extractMetaErrorContext } from './meta-api-error.js';

const logger = createLogger('MetaApi');

export function logMetaApiError(
  operationName: string,
  error: unknown,
  extra?: Record<string, unknown>,
  feature = 'meta-ads'
): void {
  if (error instanceof MetaApiError && error.isExpected) {
    logger.warn(`${operationName}: ${error.message}`, {
      feature,
      ...extra,
      ...extractMetaErrorContext(error),
    });
    return;
  }
  logError(operationName, error, {
    feature,
    extra: { ...extra, ...extractMetaErrorContext(error) },
  });
}
