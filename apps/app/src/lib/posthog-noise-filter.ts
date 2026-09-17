import type { BeforeSendFn, CaptureResult } from 'posthog-js';

import {
  type SentryEventLike,
  classifyDroppableEvent,
} from '@/lib/sentry-filter';

type ExceptionValues = NonNullable<SentryEventLike['exception']>['values'];

/**
 * Map PostHog's exception properties onto the shape the shared predicate reads.
 *
 * `$exception_list` IS the array of `{ type, value, stacktrace: { frames } }` —
 * the same structure Sentry puts in `exception.values` — so no per-entry
 * translation is needed. `$exception_values` is PostHog's flattened list of
 * messages, included as a FALLBACK for events that carry it without a list —
 * genuinely a fallback: `classifyDroppableEvent` joins `message` and every
 * `exception.values[].value` into one string to test its rules against, so
 * setting BOTH here would concatenate the same text twice and break any rule
 * anchored with `^...$` (see sentry-filter.ts's ENG-853 rules).
 */
const toSentryEventLike = (
  properties: Record<string, unknown>
): SentryEventLike => {
  const list = properties.$exception_list;
  const messages = properties.$exception_values;
  const hasList = Array.isArray(list) && list.length > 0;

  return {
    exception: {
      values: hasList ? (list as ExceptionValues) : undefined,
    },
    message:
      !hasList && Array.isArray(messages)
        ? messages.filter((m): m is string => typeof m === 'string').join(' ')
        : undefined,
  };
};

/**
 * ENG-853: force the `handled` mechanism flag to `false` for events that came
 * through our unhandled-error path (`reportUnhandledToPostHog`, tagged
 * `feature: 'unhandled'`).
 *
 * `posthog.captureException()` hardcodes `{ handled: true }` when it builds
 * `$exception_list` (see `PostHog.prototype.captureException` in
 * posthog-core.js: `buildProperties(error, { handled: true, ... })`), and
 * there is no supported way to override it via `captureException`'s
 * `additionalProperties` argument — that argument is shallow-spread AFTER the
 * SDK-built properties, so the only way to change `handled` through it would
 * be to hand back a whole replacement `$exception_list` (frames, type, value
 * and all), which would throw away the real stack the SDK just parsed for us.
 * Flipping the flag here, on the already-built event, is the only place that
 * doesn't require reconstructing that.
 *
 * Without this, every "unhandled" PostHog event reported itself as
 * `handled: true` — indistinguishable from an error we deliberately caught —
 * which is why `$exception_handled: false` used to be sent as an `extra`
 * property (log-error.ts): that key is not one PostHog derives `handled`
 * from, so it was a no-op.
 */
function markAsUnhandled(properties: Record<string, unknown>): void {
  const list = properties.$exception_list;
  if (!Array.isArray(list)) return;
  const first = list[0] as { mechanism?: { handled?: boolean } } | undefined;
  if (first?.mechanism) {
    first.mechanism.handled = false;
  }
}

/**
 * Apply the SAME noise rules to PostHog that Sentry already applies.
 *
 * Sentry drops a set of non-defects in its `beforeSend` (extension injection,
 * expected user conditions like an expired session or a plan gate, one client's
 * connectivity) — see `sentry-filter.ts`, where the rules and the reasoning for
 * each live. PostHog had no equivalent, so as PostHog becomes the primary error
 * source it would inherit exactly the noise that made the Sentry stream
 * unreadable: eleven of the Linear tickets closed on 2026-07-30 were this.
 *
 * The predicate is REUSED, not reimplemented, so the two sinks cannot drift
 * apart on which errors count. `classifyDroppableEvent` already takes a
 * structural `SentryEventLike` rather than a Sentry SDK type, which is what
 * makes that possible.
 */
export const dropPostHogNoise: BeforeSendFn = (
  event: CaptureResult | null
): CaptureResult | null => {
  if (!event) return event;
  // Only exceptions are filtered. This hook sees EVERY captured event, so
  // analytics ($pageview, $autocapture, $feature_flag_called…) must pass through
  // untouched — a filter that swallowed those would silently break product
  // analytics, which is the one thing worse than noisy error tracking.
  if (event.event !== '$exception') return event;

  const reason = classifyDroppableEvent(toSentryEventLike(event.properties));
  if (reason) {
    // Dropped silently in production, as in Sentry. In dev, leave a breadcrumb
    // so a developer does not conclude their error vanished into thin air.
    if (import.meta.env.DEV) {
      console.debug(`[posthog] dropped ${reason}`, event.properties);
    }
    return null;
  }

  if (event.properties.feature === 'unhandled') {
    markAsUnhandled(event.properties);
  }

  return event;
};
