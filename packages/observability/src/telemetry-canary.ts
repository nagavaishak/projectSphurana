import { getLogger, getTelemetryStats } from './logger.js';
import {
  getDeployEnvironment,
  isPostHogInitialized,
  trackEvent,
} from './posthog/index.js';

const DEFAULT_INTERVAL_MS = 60_000;

export interface TelemetryCanaryOptions {
  /** Service emitting the canary, e.g. `'api'` or `'video-worker'`. */
  service: string;
  /** How often to emit, in ms (default 60s). */
  intervalMs?: number;
}

export interface TelemetryCanarySnapshot {
  service: string;
  environment: string;
  /** Monotonic counter — a flat value across ticks means the timer is dead. */
  sequence: number;
  posthogLive: boolean;
  logtailConfigured: boolean;
  loggerExplicitlyInitialized: boolean;
  /** Logs dropped by the Logtail client since the previous tick. */
  droppedDelta: number;
  /** Logs dropped locally (redaction failures) since the previous tick. */
  localDroppedDelta: number;
  /** Logs synced to Better Stack since the previous tick. */
  syncedDelta: number;
  /** Cumulative logs the Logtail client has dropped since process start. */
  droppedTotal: number;
}

/**
 * Emit a periodic proof-of-life on BOTH telemetry paths at once.
 *
 * Why this exists: the forwarding path cannot report its own death.
 * `@logtail/core` swallows send failures to `console.error`, which is not itself
 * forwarded, and a missing token just yields a null client while pino keeps
 * writing to stdout. So "no error rows in Better Stack" is indistinguishable
 * from "the service had no errors" — and during the incident that prompted this,
 * hours went into deciding which of the two it was. That ambiguity is the bug.
 *
 * Each tick emits the SAME snapshot twice:
 *  - a structured `telemetry.canary` log line (Better Stack), and
 *  - a `telemetry_canary` PostHog event.
 *
 * That makes every failure mode observable by ABSENCE or by DISAGREEMENT:
 *  - line present, event missing  → PostHog client is dead (or duplicated —
 *    the recurring two-peer-variants bug, where one copy is never initialized)
 *  - event present, line missing  → the Better Stack path is dead
 *  - neither                      → the process or the timer is dead
 *  - both present, `droppedDelta` > 0 → the pipeline is alive but losing logs
 *
 * `sequence` increments every tick, so a stuck value proves the timer stopped
 * even if some lines are still arriving from elsewhere.
 *
 * Returns a stop function. The interval is `unref`'d so it never holds the
 * process open.
 */
export const startTelemetryCanary = (
  options: TelemetryCanaryOptions
): (() => void) => {
  const { service, intervalMs = DEFAULT_INTERVAL_MS } = options;
  const environment = getDeployEnvironment();

  let sequence = 0;
  let lastDropped = 0;
  let lastLocalDropped = 0;
  let lastSynced = 0;

  const tick = (): void => {
    const stats = getTelemetryStats();
    sequence += 1;

    const snapshot: TelemetryCanarySnapshot = {
      service,
      environment,
      sequence,
      posthogLive: isPostHogInitialized(),
      logtailConfigured: stats.logtailConfigured,
      loggerExplicitlyInitialized: stats.loggerExplicitlyInitialized,
      droppedDelta: stats.dropped - lastDropped,
      localDroppedDelta: stats.localDropped - lastLocalDropped,
      syncedDelta: stats.synced - lastSynced,
      droppedTotal: stats.dropped,
    };

    lastDropped = stats.dropped;
    lastLocalDropped = stats.localDropped;
    lastSynced = stats.synced;

    const logger = getLogger();

    // Path A: structured log → Better Stack. Alert on ABSENCE of this line.
    logger.info('telemetry.canary', { ...snapshot });

    // Path B: product event → PostHog. Alert on absence of this event.
    if (snapshot.posthogLive) {
      trackEvent(
        service,
        'telemetry_canary',
        { ...snapshot },
        { personless: true }
      );
    }

    // A live-but-lossy pipeline: loud, and queryable in both systems.
    if (snapshot.droppedDelta > 0 || snapshot.localDroppedDelta > 0) {
      logger.warn('telemetry.canary: log forwarding is dropping lines', {
        ...snapshot,
      });
    }

    // The silent-forever configuration: pino writes to stdout and the process
    // looks perfectly healthy while nothing ever reaches Better Stack.
    if (!snapshot.logtailConfigured) {
      logger.warn(
        'telemetry.canary: no Logtail token — logs are NOT reaching Better Stack',
        { ...snapshot }
      );
    }
  };

  tick();
  const timer = setInterval(tick, intervalMs);
  if (typeof timer.unref === 'function') timer.unref();

  return () => clearInterval(timer);
};
