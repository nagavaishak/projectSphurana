import { logError } from '../sentry/index.js';
import { getDeployEnvironment, isPostHogInitialized } from './client.js';

const DEFAULT_INTERVAL_MS = 60_000;

export interface PostHogHeartbeatOptions {
  /**
   * Better Stack heartbeat URL dedicated to PostHog telemetry liveness
   * (`BETTERSTACK_POSTHOG_HEARTBEAT_URL`). When unset, the heartbeat is a no-op.
   */
  heartbeatUrl?: string;
  /** Service emitting the heartbeat, e.g. `'api'` or `'worker'` (for logs). */
  service: string;
  /** How often to ping, in ms (default 60s). */
  intervalMs?: number;
}

/**
 * Start a PostHog-telemetry liveness heartbeat against Better Stack.
 *
 * Pings the Better Stack heartbeat URL **only while the PostHog backend client
 * is live** (`isPostHogInitialized()`, i.e. `client !== null`). If PostHog is
 * NOT live in an environment where it must be (production/preview), it
 * deliberately skips the ping — so Better Stack stops receiving heartbeats and
 * raises an incident — and logs loudly (Pino → Better Stack Logs) so the cause
 * is visible immediately.
 *
 * This is the dead-man's switch for the failure that silently dropped every
 * backend product event for ~8 days with no signal: the process stayed alive
 * (its own process heartbeat kept pinging) while PostHog telemetry was dead.
 * Gating THIS ping on PostHog liveness is what makes that detectable.
 *
 * Returns a stop function, or `null` when no URL is configured. The interval is
 * `unref`'d so it never keeps the process alive.
 */
export const startPostHogHeartbeat = (
  options: PostHogHeartbeatOptions
): (() => void) | null => {
  const { heartbeatUrl, service, intervalMs = DEFAULT_INTERVAL_MS } = options;
  const environment = getDeployEnvironment();
  const shouldBeLive =
    environment === 'production' || environment === 'preview';

  if (!heartbeatUrl) {
    console.log(
      '[Observability] BETTERSTACK_POSTHOG_HEARTBEAT_URL not set, skipping PostHog heartbeat'
    );
    return null;
  }

  let loggedNotLive = false;

  const tick = async (): Promise<void> => {
    if (isPostHogInitialized()) {
      // Telemetry is live — ping the dead-man's switch. A failed ping is itself
      // the signal Better Stack watches for, so never throw out of the timer.
      await fetch(heartbeatUrl).catch(() => {
        // swallow — a missed ping surfaces as a Better Stack incident
      });
      return;
    }

    if (shouldBeLive && !loggedNotLive) {
      loggedNotLive = true;
      // Log once to Sentry; the skipped ping itself is the ongoing signal
      // Better Stack watches for — no need to spam Sentry every tick.
      logError(
        'observability.posthogHeartbeat',
        new Error(
          `PostHog backend client is NOT live in '${environment}' (service=${service}); tracked/trackedResult product events are being dropped. Skipping heartbeat ping.`
        ),
        { feature: 'observability', extra: { service, environment } }
      );
    }
  };

  void tick();
  const timer = setInterval(() => void tick(), intervalMs);
  if (typeof timer.unref === 'function') timer.unref();

  return () => clearInterval(timer);
};
