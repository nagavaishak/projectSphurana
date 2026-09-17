import * as Sentry from '@sentry/react';
import posthog from 'posthog-js';

interface LogErrorContext {
  feature?: string;
  tags?: Record<string, string>;
  extra?: Record<string, unknown>;
}

interface QueuedCapture {
  error: unknown;
  feature: string;
  operation: string;
  context?: LogErrorContext;
  level: 'error' | 'warning';
}

/**
 * Errors raised before posthog-js finished initializing.
 *
 * Sentry initializes SYNCHRONOUSLY during `TelemetryBootstrap`'s first render;
 * posthog-js initializes in a `useEffect` in `PostHogProvider`, i.e. after
 * paint. Anything that fails in between used to hit `!posthog.__loaded` and be
 * dropped on the floor — Sentry-only by construction. That is the WEB-15
 * ("Intercom.sendPushTokenToIntercom is not implemented on ios", 12 events) and
 * WEB-33 (push-token timeout at sign-in) class: boot-time errors that existed in
 * Sentry and nowhere else.
 *
 * Bounded, because an error loop must not become a memory leak. The FIRST
 * entries are kept rather than the last: boot-time errors are the ones this
 * queue exists for, and a later flood is usually the same error repeating.
 */
const preInitQueue: QueuedCapture[] = [];
const PRE_INIT_QUEUE_LIMIT = 50;

/**
 * Forward a caught error to PostHog Error Tracking, alongside Sentry. Queues
 * until posthog-js has loaded (see {@link preInitQueue}); replayed by
 * {@link flushPostHogErrorQueue}.
 *
 * Error capture bypasses the DNT opt-out: users who have opted out of
 * analytics (e.g. via Brave's built-in DNT flag and `respect_dnt: true`)
 * still expect error reporting to work so the product stays reliable.
 * We temporarily opt in, capture, then restore the opted-out state.
 * posthog-js 1.335.2: `opt_out_capturing()` does NOT clear the in-memory
 * request queue, so the queued exception is sent on the next flush.
 *
 * `error` is deliberately `unknown`, not `Error` (posthog-js's own
 * `captureException(error: unknown, ...)` types it the same way). Callers
 * that already hold an `Error` (logError/logWarning) keep doing so; callers
 * that only hold a raw, possibly non-Error value (reportUnhandledToPostHog)
 * now pass it straight through instead of re-wrapping it — see that
 * function's doc comment for why re-wrapping was the bug.
 */
function captureToPostHog(
  error: unknown,
  feature: string,
  operation: string,
  context?: LogErrorContext,
  level: 'error' | 'warning' = 'error'
): void {
  if (!posthog.__loaded) {
    if (preInitQueue.length < PRE_INIT_QUEUE_LIMIT) {
      preInitQueue.push({ error, feature, operation, context, level });
    }
    return;
  }

  const wasOptedOut = posthog.has_opted_out_capturing();
  // captureEventName: false skips the automatic "opted-in" analytics event.
  if (wasOptedOut) posthog.opt_in_capturing({ captureEventName: false });

  posthog.captureException(error, {
    // posthog-js spreads these over the derived $exception_* properties, so
    // this overrides the default level (see logWarning).
    $exception_level: level,
    feature,
    operation,
    ...context?.tags,
    ...context?.extra,
  });

  if (wasOptedOut) posthog.opt_out_capturing();
}

/**
 * Replay errors captured before posthog-js was ready. Call once, immediately
 * after `posthog.init`.
 *
 * Safe to call when PostHog never initializes (no key): the queue simply stays
 * put, capped at {@link PRE_INIT_QUEUE_LIMIT}.
 */
export function flushPostHogErrorQueue(): void {
  if (!posthog.__loaded) return;

  // Splice first: a captureException that somehow re-enters must not see the
  // entry it is replaying and loop.
  const queued = preInitQueue.splice(0, preInitQueue.length);
  for (const item of queued) {
    captureToPostHog(
      item.error,
      item.feature,
      item.operation,
      item.context,
      item.level
    );
  }
}

/**
 * Best-effort human-readable message for a raw, possibly non-Error value —
 * used ONLY to build a grouping fingerprint (see {@link reportUnhandledToPostHog}),
 * never sent as the captured exception itself.
 */
function unhandledErrorMessage(value: unknown): string {
  if (typeof value === 'string') return value;
  if (
    value &&
    typeof value === 'object' &&
    'message' in value &&
    typeof (value as { message?: unknown }).message === 'string'
  ) {
    return (value as { message: string }).message;
  }
  return String(value);
}

/**
 * Report an UNHANDLED error to PostHog only.
 *
 * Sentry already sees these through its own globally-installed handlers, which
 * are registered synchronously at `Sentry.init`. posthog-js's equivalent
 * (`capture_exceptions`) fetches its handler script lazily AFTER init, so it was
 * reliably late and sometimes never armed — which is why WEB-29
 * (`defaultOnUncaughtError` on /dashboard/sales) sat in Sentry with no PostHog
 * twin. We now install the listeners ourselves, synchronously, and route them
 * here; `capture_exceptions` is off so there is exactly one owner and no
 * double-capture.
 *
 * Deliberately does NOT touch Sentry: adding a second Sentry report would
 * duplicate every unhandled error into a separate issue.
 *
 * ENG-853: `error` is passed to {@link captureToPostHog} RAW — it used to be
 * re-wrapped as `new Error(String(error))` here, which discarded whatever
 * `error` actually was and replaced it with a brand new Error whose stack
 * pointed at THIS call site, always the same two frames (the
 * `window.addEventListener` handler in global-error-handlers.ts, then here).
 * Every unhandled error — a Chrome ResizeObserver notice, a Safari password
 * manager's cross-realm error, a Mobile Safari timeout — ended up with an
 * IDENTICAL stack and therefore grouped into one PostHog issue, regardless of
 * how different the underlying problems were. Passing the raw value lets
 * posthog-js's own coercion (`ErrorCoercer`/`DOMExceptionCoercer`) read the
 * value's OWN stack when it has one — which is what carries the extension /
 * injected-script origin frames `classifyDroppableEvent` (sentry-filter.ts)
 * needs to filter noise instead of misattributing it to us.
 *
 * Not every unhandled value has a usable stack, though: `posthog.captureException`
 * only recognises same-realm `Error` instances that way (`x instanceof Error`,
 * see `ErrorCoercer.match` in `@posthog/core`). A plain string or a
 * cross-realm error-like object (Safari autofill runs its error in a
 * different JS realm, so `instanceof Error` is false even though it has a
 * real `name`/`message`/`stack`) falls through to the SDK's fallback
 * coercers, which stamp EVERY such event with the SAME synthetic stack — the
 * stack of `new Error('PostHog syntheticException')`, created once inside
 * `posthog.captureException` itself. That reintroduces the exact bug one
 * level down, just inside the SDK instead of inside our wrapper. So for those
 * values we override PostHog's grouping explicitly with `$exception_fingerprint`,
 * keyed on the value's own message, so distinct messages don't collide under
 * one synthetic-stack bucket. PostHog documents `$exception_fingerprint` as a
 * plain string (https://posthog.com/docs/error-tracking/capture#customizing-exception-capture),
 * not an array — colon-joined here, matching the backend's equivalent
 * (ENG-853 PR #969).
 */
/**
 * A value that walks and talks like an Error but fails `instanceof Error` —
 * the shape a Safari autofill / password-manager content script produces,
 * because it was constructed in a different JS realm. posthog-js's
 * `captureException` only reads the OWN stack of a same-realm `Error`; any
 * other object goes through its generic coercer, which (a) rewrites the value
 * to `'Error' captured as exception with message: '…'` and (b) stamps the
 * SDK's synthetic stack on it. Both defeat `classifyDroppableEvent`: the
 * anchored message rules no longer match, and the extension-origin frames
 * that would identify the noise are gone. Verified in-browser on 2026-09-02.
 */
function isErrorLike(
  value: unknown
): value is { name?: unknown; message: string; stack?: unknown } {
  return (
    !!value &&
    typeof value === 'object' &&
    typeof (value as { message?: unknown }).message === 'string'
  );
}

/**
 * Rebuild a cross-realm error-like value as a same-realm `Error` that keeps
 * the ORIGINAL name, message and stack string, so posthog-js parses the real
 * frames (extension origin included) instead of substituting its own.
 */
function toSameRealmError(value: {
  name?: unknown;
  message: string;
  stack?: unknown;
}): Error {
  const err = new Error(value.message);
  if (typeof value.name === 'string' && value.name) err.name = value.name;
  if (typeof value.stack === 'string' && value.stack) err.stack = value.stack;
  return err;
}

export function reportUnhandledToPostHog(
  error: unknown,
  source: 'window.onerror' | 'unhandledrejection'
): void {
  const extra: Record<string, unknown> = {};

  let capturable: unknown = error;
  if (!(error instanceof Error) && isErrorLike(error)) {
    // Same-realm Error with the original stack: the SDK groups on its real
    // frames and the noise filter can see where it came from.
    capturable = toSameRealmError(error);
  } else if (!(error instanceof Error)) {
    // Strings / non-error objects can only get the SDK's synthetic stack, so
    // group them by message ourselves or they all collapse into one issue.
    const message = unhandledErrorMessage(error).slice(0, 200);
    extra.$exception_fingerprint = `unhandled:${source}:${message}`;
  }

  captureToPostHog(capturable, 'unhandled', source, { extra });
}

/**
 * Log an error to both console and Sentry.
 * Works in both client and server components.
 *
 * @example
 * ```ts
 * try {
 *   await riskyOperation();
 * } catch (error) {
 *   logError('billing.checkout', error, { extra: { planId } });
 * }
 * ```
 */
export function logError(
  operation: string,
  error: unknown,
  context?: LogErrorContext
): void {
  const err = error instanceof Error ? error : new Error(String(error));
  const feature = context?.feature ?? operation.split('.')[0];

  console.error(`[${operation}]`, err.message, context?.extra ?? '');

  captureToPostHog(err, feature, operation, context);

  Sentry.withScope((scope) => {
    scope.setTag('feature', feature);
    scope.setTag('operation', operation);
    // Diagnose whether errors fire before posthog-js initialises.
    // If posthog_loaded=false appears consistently for a feature, a
    // queueing strategy is needed.
    scope.setTag('posthog_loaded', String(posthog.__loaded));
    if (context?.tags) {
      for (const [key, value] of Object.entries(context.tags)) {
        scope.setTag(key, value);
      }
    }
    if (context?.extra) {
      scope.setExtras(context.extra);
    }
    Sentry.captureException(err);
  });
}

/**
 * Log a warning to the console, PostHog and Sentry.
 * Use for non-critical issues that should be tracked (e.g., degraded state).
 *
 * Dual-sends to PostHog exactly like {@link logError}. Until 2026-08 this went
 * to Sentry ONLY, so warning-level issues (e.g. `upload.analysisTimeout`) were
 * invisible in PostHog — a hole that would have survived a cutover to PostHog
 * as the primary error source. PostHog Error Tracking has no separate "message"
 * concept, so a warning is sent as an `$exception` with
 * `$exception_level: 'warning'` (mirroring what `Sentry.captureMessage` does
 * internally: synthesize an error to carry the stack). Filter it out with
 * `properties.$exception_level != 'warning'` when you want errors only.
 */
export function logWarning(
  operation: string,
  message: string,
  context?: LogErrorContext
): void {
  const feature = context?.feature ?? operation.split('.')[0];

  console.warn(`[${operation}]`, message, context?.extra ?? '');

  // The synthesized Error's stack points at this call site, which is the useful
  // frame for a warning that has no thrown error of its own.
  captureToPostHog(new Error(message), feature, operation, context, 'warning');

  Sentry.captureMessage(`[${operation}] ${message}`, {
    level: 'warning',
    tags: {
      feature,
      operation,
      // Same diagnostic as logError: if posthog_loaded=false shows up here,
      // the PostHog copy of this warning was dropped before init.
      posthog_loaded: String(posthog.__loaded),
      ...context?.tags,
    },
    extra: context?.extra,
  });
}
