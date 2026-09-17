import * as Sentry from '@sentry/node';
import { getCurrentUserId } from '../context.js';
import { getLogger } from '../logger.js';
import { capturePostHogException } from '../posthog/client.js';
import {
  buildFallbackFingerprint,
  hasAppStackFrame,
} from '../posthog/exception-fingerprint.js';
import {
  forwardErrorToBetterStack,
  forwardEventToBetterStack,
} from './betterstack-forwarder.js';
import type { SentryConfig } from './types.js';

let isInitialized = false;

/**
 * Initialize Sentry error tracking
 * Call this once at application startup (e.g., in main.ts)
 */
export const initSentry = (config: SentryConfig): void => {
  if (isInitialized) {
    console.warn('[Observability] Sentry already initialized');
    return;
  }

  if (!config.dsn) {
    console.warn(
      '[Observability] Sentry DSN not provided, skipping initialization'
    );
    return;
  }

  Sentry.init({
    dsn: config.dsn,
    environment: config.environment ?? 'development',
    release: config.release,
    debug: config.debug ?? false,
    // Performance monitoring - use provided rate or default based on environment
    tracesSampleRate:
      config.tracesSampleRate ??
      (config.environment === 'production' ? 0.1 : 1.0),
    beforeSend: async (event, hint) => {
      const filtered = config.beforeSend
        ? await config.beforeSend(event, hint)
        : event;
      if (filtered) forwardEventToBetterStack(filtered);
      return filtered;
    },
  });

  isInitialized = true;
  console.log('[Observability] Sentry initialized');
};

/**
 * Check if Sentry is initialized
 */
export const isSentryInitialized = (): boolean => isInitialized;

/**
 * Capture an exception and send to Sentry
 */
export const captureException = (
  error: Error,
  context?: {
    tags?: Record<string, string>;
    extra?: Record<string, unknown>;
    user?: { id?: string; email?: string };
  }
): string | undefined => {
  // Coverage parity: anything worth a PostHog $exception is worth a structured
  // log row too. Without this, every error routed through captureException()
  // — notably the `tracked()` wrapper's catch — reached PostHog and Sentry but
  // was invisible in Better Stack, so it could not be queried or alerted on
  // there. `logError()` already logs; this closes the other entry point.
  getLogger().error(error.message, {
    errorName: error.name,
    stack: error.stack,
    ...context?.tags,
    ...context?.extra,
  });

  // Dual-send to PostHog Error Tracking, regardless of Sentry state — this is
  // the migration's parallel run, so PostHog must receive the error even when
  // Sentry is disabled/uninitialized.
  capturePostHogException(error, context?.user?.id ?? getCurrentUserId(), {
    ...context?.tags,
    ...context?.extra,
  });

  if (!isInitialized) {
    // Sentry is off, so its `beforeSend` bridge will not carry this to
    // BetterStack. Send it directly instead — BetterStack must not go dark just
    // because Sentry did. See forwardErrorToBetterStack.
    forwardErrorToBetterStack(error, {
      tags: context?.tags,
      extra: context?.extra,
      user: context?.user,
    });
    return undefined;
  }

  return Sentry.captureException(error, {
    tags: context?.tags,
    extra: context?.extra,
    user: context?.user,
  });
};

/**
 * Capture a message and send to Sentry
 */
export const captureMessage = (
  message: string,
  level: 'info' | 'warning' | 'error' = 'info',
  context?: {
    tags?: Record<string, string>;
    extra?: Record<string, unknown>;
  }
): string | undefined => {
  if (!isInitialized) {
    console.log(
      `[Observability] Sentry not initialized, logging message locally: [${level}] ${message}`
    );
    return undefined;
  }

  return Sentry.captureMessage(message, {
    level,
    tags: context?.tags,
    extra: context?.extra,
  });
};

/**
 * Set user context for all subsequent events
 */
export const setUser = (
  user: { id?: string; email?: string; username?: string } | null
): void => {
  Sentry.setUser(user);
};

/**
 * Add a breadcrumb for debugging
 */
export const addBreadcrumb = (breadcrumb: {
  message: string;
  category?: string;
  level?: 'debug' | 'info' | 'warning' | 'error';
  data?: Record<string, unknown>;
}): void => {
  Sentry.addBreadcrumb({
    message: breadcrumb.message,
    category: breadcrumb.category,
    level: breadcrumb.level ?? 'info',
    data: breadcrumb.data,
  });
};

/**
 * Flush pending events before shutdown
 */
export const flush = async (timeout = 2000): Promise<boolean> => {
  return Sentry.flush(timeout);
};

export interface LogErrorContext {
  /** Feature/module name for grouping */
  feature?: string;
  /** Tags for Sentry context */
  tags?: Record<string, string>;
  /** Additional data to include */
  extra?: Record<string, unknown>;
  /** User context */
  user?: { id?: string; email?: string };
}

/**
 * Universal error logger that logs to both console and Sentry.
 * Use this in catch blocks where you handle errors gracefully (don't rethrow).
 *
 * @example
 * ```ts
 * try {
 *   await riskyOperation();
 * } catch (error) {
 *   logError('auth.signUp', error, { extra: { email } });
 *   return err(new FeatureError(...));
 * }
 * ```
 */
export const logError = (
  operation: string,
  error: unknown,
  context?: LogErrorContext
): void => {
  const err = error instanceof Error ? error : new Error(String(error));
  const logger = getLogger();

  // Walk the cause chain to the deepest Error. Chains are often multiple
  // levels deep (e.g. FeatureError -> DrizzleQueryError -> PostgresError),
  // so a single-level unwrap misses the real root cause.
  let cause: Error | undefined;
  let pgError: Record<string, unknown> | undefined;
  let current: unknown = err.cause;
  let depth = 0;
  while (current instanceof Error && depth < 10) {
    cause = current;
    const link = current as unknown as Record<string, unknown>;
    // The pg fields live on whichever link carries a `.code` (PostgresError)
    if (link.code !== undefined) {
      pgError = link;
    }
    current = current.cause;
    depth += 1;
  }
  const message = cause
    ? `[${operation}] ${cause.message}`
    : `[${operation}] ${err.message}`;

  // Extract database-specific fields (PostgresError from postgres.js)
  const pgFields = pgError
    ? {
        query: err.message,
        ...(pgError.code ? { dbCode: pgError.code } : {}),
        ...(pgError.detail ? { dbDetail: pgError.detail } : {}),
        ...(pgError.hint ? { dbHint: pgError.hint } : {}),
        ...(pgError.table_name ? { dbTable: pgError.table_name } : {}),
        ...(pgError.column_name ? { dbColumn: pgError.column_name } : {}),
        ...(pgError.constraint_name
          ? { dbConstraint: pgError.constraint_name }
          : {}),
      }
    : {};

  // Always log using the structured Pino logger
  logger.error(message, {
    errorName: cause?.name ?? err.name,
    stack: cause?.stack ?? err.stack,
    operation,
    feature: context?.feature,
    ...pgFields,
    ...context?.extra,
  });

  // Dual-send to PostHog Error Tracking (parallel run; independent of Sentry).
  //
  // ENG-851: capture the TOP-LEVEL error (`err`), NOT the deepest cause.
  // Unlike Sentry (which we point at the deepest cause below, unchanged),
  // PostHog's default fingerprint is frame-based: it walks the FIRST
  // exception's stack for an in-app frame
  // (https://posthog.com/docs/error-tracking/fingerprints). Driver errors
  // (postgres.js `PostgresError`, Stripe SDK errors) are constructed INSIDE
  // the driver — their stack can never contain an app frame — while the
  // wrapper (`FeatureError`, `DrizzleQueryError`) is thrown from OUR code and
  // carries the real call site. Capturing the cause instead of the wrapper is
  // exactly why every backend fault of a given TYPE (e.g. every
  // `PostgresError`) piled into one PostHog issue regardless of which query
  // or which caller produced it.
  //
  // This loses nothing for debugging: posthog-node's `captureException`
  // builds `$exception_list` by recursing through `.cause` up to
  // `MAX_CAUSE_RECURSION` (4) levels deep — see
  // `error-properties-builder.mjs` in the installed `@posthog/core` — so the
  // cause (the PostgresError/Stripe error) still appears as
  // `$exception_list[1]` (etc.) on the SAME event, just no longer driving the
  // fingerprint.
  //
  // Fallback fingerprint (ENG-851 part 2): when NEITHER the wrapper NOR any
  // link in its cause chain has an app frame at all (e.g. a fault with no
  // `apps/api/src` frame anywhere on the stack — see
  // `hasAppStackFrame`/`buildFallbackFingerprint` in
  // `../posthog/exception-fingerprint.js`), PostHog's frame-based grouping
  // has nothing to key on and falls back to the first (node-internal) frame,
  // which is identical across unrelated faults. Set `$exception_fingerprint`
  // (a plain string — PostHog's own type, not an array; see
  // https://posthog.com/docs/error-tracking/capture#customizing-exception-capture)
  // ourselves in that case so distinct faults still land in distinct issues.
  // Deliberately NOT set when an app frame exists — the SDK's frame-based
  // grouping is strictly better there (keys on the real call site, not just
  // error type + code).
  const fingerprintCode =
    (typeof pgError?.code === 'string' ? pgError.code : undefined) ??
    cause?.name;
  const fingerprintProps = hasAppStackFrame(err)
    ? {}
    : {
        $exception_fingerprint: buildFallbackFingerprint(
          operation,
          err.name,
          fingerprintCode
        ),
      };

  capturePostHogException(err, context?.user?.id ?? getCurrentUserId(), {
    operation,
    feature: context?.feature ?? operation.split('.')[0],
    ...context?.tags,
    ...pgFields,
    ...fingerprintProps,
    ...context?.extra,
  });

  // Send to Sentry if initialized
  if (isInitialized) {
    Sentry.withScope((scope) => {
      scope.setTag('feature', context?.feature ?? operation.split('.')[0]);
      scope.setTag('operation', operation);
      if (context?.tags) {
        for (const [key, value] of Object.entries(context.tags)) {
          scope.setTag(key, value);
        }
      }
      if (cause) {
        // Include database-specific error details (PostgresError fields,
        // found on whichever cause-chain link carries them)
        scope.setExtras({
          dbErrorCode: pgError?.code,
          dbErrorDetail: pgError?.detail,
          dbErrorHint: pgError?.hint,
          dbErrorQuery: err.message,
          ...context?.extra,
        });
      } else if (context?.extra) {
        scope.setExtras(context.extra);
      }
      if (context?.user) {
        scope.setUser(context.user);
      }
      // Capture the root cause if available, so Sentry groups by the real error
      Sentry.captureException(cause ?? err);
    });
  } else {
    // Sentry off → its beforeSend bridge cannot carry this to BetterStack.
    forwardErrorToBetterStack(err, {
      operation,
      feature: context?.feature ?? operation.split('.')[0],
      tags: context?.tags,
      extra: {
        dbErrorCode: pgError?.code,
        dbErrorDetail: pgError?.detail,
        dbErrorHint: pgError?.hint,
        ...context?.extra,
      },
      user: context?.user,
    });
  }
};

/**
 * Log a warning to the structured logger, PostHog and Sentry.
 * Use for non-critical issues that should be tracked.
 *
 * Dual-sends to PostHog exactly like {@link logError}. Until 2026-08 this went
 * to Sentry ONLY, which made every warning-level issue invisible in PostHog —
 * a coverage hole that would have silently survived a cutover to PostHog as the
 * primary error source. PostHog Error Tracking has no separate "message"
 * concept, so a warning is sent as an `$exception` with
 * `$exception_level: 'warning'` (mirroring what `Sentry.captureMessage` does
 * internally: synthesize an error to carry the stack). Filter it out with
 * `properties.$exception_level != 'warning'` when you want errors only.
 */
export const logWarning = (
  operation: string,
  message: string,
  context?: LogErrorContext
): void => {
  const logger = getLogger();
  const feature = context?.feature ?? operation.split('.')[0];

  // Always log using the structured Pino logger
  logger.warn(`[${operation}] ${message}`, {
    operation,
    feature,
    ...context?.extra,
  });

  // Dual-send to PostHog Error Tracking (independent of Sentry's state, as in
  // logError). The synthesized Error's stack points at this call site, which is
  // the useful frame for a warning that has no thrown error of its own.
  capturePostHogException(
    new Error(message),
    context?.user?.id ?? getCurrentUserId(),
    {
      $exception_level: 'warning',
      operation,
      feature,
      ...context?.tags,
      ...context?.extra,
    }
  );

  // Send to Sentry if initialized
  if (isInitialized) {
    Sentry.captureMessage(message, {
      level: 'warning',
      tags: {
        feature,
        operation,
        ...context?.tags,
      },
      extra: context?.extra,
    });
  } else {
    // Sentry off → its beforeSend bridge cannot carry this to BetterStack.
    forwardErrorToBetterStack(new Error(message), {
      level: 'warning',
      operation,
      feature,
      tags: context?.tags,
      extra: context?.extra,
      user: context?.user,
    });
  }
};
