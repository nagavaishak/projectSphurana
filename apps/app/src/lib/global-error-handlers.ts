import { reportUnhandledToPostHog } from '@/lib/log-error';

/**
 * Own the unhandled-error path for PostHog, synchronously.
 *
 * THE PROBLEM THIS FIXES. Sentry's global handlers are installed synchronously
 * inside `Sentry.init`. posthog-js's equivalent (`capture_exceptions: true`)
 * loads `exception-autocapture.js` as a separate script AFTER init and only
 * installs its listeners when that resolves — so for the whole boot window, and
 * indefinitely if the fetch is blocked, unhandled errors reached Sentry and not
 * PostHog. A 30-day production diff found exactly that shape: WEB-15 (Intercom
 * plugin error at boot) and WEB-29 (`defaultOnUncaughtError` on
 * /dashboard/sales) existed in Sentry with no PostHog counterpart, and neither
 * carried a `posthog_loaded` tag — proof they never went through `logError`.
 *
 * So: `capture_exceptions` is now OFF and we install the listeners here, at
 * module-evaluation time, before React renders. One owner, no lazy fetch, no
 * double-capture. Errors raised before posthog-js is ready are buffered by
 * `log-error.ts` and replayed on init.
 *
 * These listeners are PASSIVE: they never preventDefault, so the browser still
 * logs to console and Sentry's own handlers still fire. Reporting to Sentry from
 * here would duplicate every unhandled error into a second issue.
 */
let installed = false;

export function installGlobalErrorHandlers(): void {
  if (installed) return;
  if (typeof window === 'undefined') return;
  installed = true;

  window.addEventListener('error', (event: ErrorEvent) => {
    // `event.error` is absent for cross-origin script errors ("Script error.")
    // and for some resource-load failures; fall back to the message so the
    // event is still counted rather than silently skipped.
    reportUnhandledToPostHog(event.error ?? event.message, 'window.onerror');
  });

  window.addEventListener(
    'unhandledrejection',
    (event: PromiseRejectionEvent) => {
      reportUnhandledToPostHog(event.reason, 'unhandledrejection');
    }
  );
}
