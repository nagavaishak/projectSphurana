// Server-side error capture for the marketing site's on-demand routes.
//
// WHY THIS EXISTS: the site had `@sentry/astro` (client AND server) but PostHog
// only in a client React provider (`components/providers/posthog-provider.tsx`).
// Server-rendered errors therefore reached Sentry and NOTHING reached PostHog —
// e.g. "Unexpectedly unable to find a component instance for route /404" on
// `GET /blog/[slug]`, 9 production events over 30 days with zero PostHog
// counterpart — no marketing-originated `$exception` existed in PostHog at all.
// That is a blocker for treating PostHog as the primary error source.
//
// Verified working on a live preview (2026-08-17): both a page-render throw and
// an endpoint throw arrive in PostHog with `service: marketing-astro` and the
// route, method and URL attached.
//
// Deliberately NOT using `@borradh-workspace/observability`: that package
// initializes its own Sentry node client (which would collide with
// `@sentry/astro`'s) and pulls in pino/Better Stack forwarding that the
// marketing site has no configuration for. A ~50-line direct posthog-node
// client is the smaller, non-conflicting surface.
import { PostHog } from 'posthog-node';

import { resolveAppEnv } from '@/lib/config';

/**
 * A client is built per report and shut down again, rather than reused across
 * invocations of a warm instance. See {@link captureServerException} — delivery
 * requires `shutdown()`, which ends the client, so there is nothing to reuse.
 * Errors are rare and a client is just config plus a fetch, so this costs
 * nothing worth optimising.
 */
const buildClient = (): PostHog | null => {
  const apiKey = process.env.PUBLIC_POSTHOG_KEY;
  if (!apiKey) return null;

  return new PostHog(apiKey, {
    // Server-side goes direct to PostHog. The `/r3y` reverse proxy the browser
    // uses exists to dodge ad-blockers, which is not a concern here — and
    // routing through our own site would make error capture depend on the site
    // that is currently erroring.
    host: process.env.PUBLIC_POSTHOG_HOST ?? 'https://eu.i.posthog.com',
    // Send each event on its own; never wait for a 20-event batch that a frozen
    // instance will never flush.
    flushAt: 1,
    flushInterval: 0,
  });
};

/**
 * Cap on waiting for delivery. A hung PostHog request must not hold the error
 * response open indefinitely — the visitor is already getting a 500.
 */
const DELIVERY_TIMEOUT_MS = 3000;

/**
 * The environment tag stamped on every event. Shares {@link resolveAppEnv} with
 * the client-side config so the two can never disagree — the whole
 * prod-vs-preview split in PostHog is queried on `properties.environment`, and a
 * mismatch would file errors under the wrong environment and hide them from
 * exactly the queries that matter.
 */
const environment = (): string => resolveAppEnv();

/**
 * Capture a server-side exception to PostHog Error Tracking, and WAIT for it to
 * actually be delivered before returning.
 *
 * THE TRAP, found by probing a live preview on 2026-08-17: the first version of
 * this called `await posthog.captureExceptionImmediate(...)` and lost every
 * event. The middleware caught the error correctly and no reporting error was
 * logged — the send simply never completed. `captureExceptionImmediate` is
 * declared `async`, but its body registers a pending promise and returns without
 * awaiting it:
 *
 *     async captureExceptionImmediate(error, distinctId, props) {
 *       this.addPendingPromise(buildEventMessage(...).then(m => this.captureImmediate(m)))
 *     }                        // ^ return value discarded — resolves instantly
 *
 * "Immediate" means "bypass the batch queue", NOT "await delivery". Awaiting it
 * resolves before the event is even built, and on Vercel the instance freezes as
 * soon as the response returns, so the pending promise never runs. `flush()` is
 * no better on its own: it queues its own promise rather than joining the
 * existing ones.
 *
 * `shutdown()` is the only call that does `promiseQueue.join()` and then drains
 * the persisted queue — which is exactly why PostHog documents it as the
 * serverless idiom. It ends the client, hence one client per report.
 *
 * Never throws: a failure to report must not replace the real error.
 */
export const captureServerException = async (
  error: unknown,
  context?: { url?: string; route?: string; method?: string }
): Promise<void> => {
  const posthog = buildClient();
  if (!posthog) {
    // The key is read from the SERVERLESS runtime env, which is not the same
    // thing as it being present at build time (where it gets inlined into the
    // page for the browser). If this fires, marketing SSR errors are reaching
    // nothing at all — the exact silent gap this module was added to close.
    console.error(
      '[server-observability] PUBLIC_POSTHOG_KEY missing at runtime — SSR errors are NOT being reported to PostHog'
    );
    return;
  }

  const err = error instanceof Error ? error : new Error(String(error));
  const properties = {
    environment: environment(),
    // `service` is the discriminator for "marketing SSR vs the API" in PostHog.
    // Do NOT reach for `$lib` here: the SDK sets it and wins, so a `$lib`
    // override is silently ignored (verified on a live preview — the events
    // arrive as `$lib: posthog-node`, same as the API). Query on `service`.
    service: 'marketing-astro',
    url: context?.url,
    route: context?.route,
    method: context?.method,
  };

  try {
    // Enqueue, then await the drain. Both calls matter: captureException on its
    // own is fire-and-forget, and shutdown is what joins the pending promises.
    posthog.captureException(err, 'marketing-server', properties);
    await posthog.shutdown(DELIVERY_TIMEOUT_MS);
  } catch (reportingError) {
    // Never rethrow — reporting must not mask the original error. But do not
    // swallow SILENTLY: a swallowed failure here is indistinguishable from
    // "everything worked", which is how a reporting gap survives for months.
    console.error(
      '[server-observability] failed to report SSR error to PostHog:',
      reportingError instanceof Error
        ? reportingError.message
        : String(reportingError)
    );
  }
};
