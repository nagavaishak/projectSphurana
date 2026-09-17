import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
const stats = {
  loggerExplicitlyInitialized: true,
  logtailConfigured: true,
  logged: 0,
  synced: 0,
  dropped: 0,
  localDropped: 0,
};

vi.mock('./logger.js', () => ({
  getLogger: () => logger,
  getTelemetryStats: () => ({ ...stats }),
}));

const trackEvent = vi.fn();
vi.mock('./posthog/index.js', () => ({
  getDeployEnvironment: () => 'production',
  isPostHogInitialized: () => true,
  trackEvent: (...args: unknown[]) => trackEvent(...args),
}));

const { startTelemetryCanary } = await import('./telemetry-canary.js');

describe('startTelemetryCanary', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    Object.assign(stats, {
      loggerExplicitlyInitialized: true,
      logtailConfigured: true,
      logged: 0,
      synced: 0,
      dropped: 0,
      localDropped: 0,
    });
  });
  afterEach(() => vi.useRealTimers());

  it('emits the same snapshot to Better Stack and PostHog on every tick', () => {
    const stop = startTelemetryCanary({ service: 'api', intervalMs: 60_000 });

    expect(logger.info).toHaveBeenCalledWith(
      'telemetry.canary',
      expect.objectContaining({ service: 'api', sequence: 1 })
    );
    expect(trackEvent).toHaveBeenCalledWith(
      'api',
      'telemetry_canary',
      expect.objectContaining({ sequence: 1 }),
      expect.objectContaining({ personless: true })
    );

    // The log payload and the PostHog payload must agree — a divergence between
    // the two systems is exactly what the canary exists to expose.
    const logged = logger.info.mock.calls[0][1];
    const tracked = trackEvent.mock.calls[0][2];
    expect(logged).toEqual(tracked);

    vi.advanceTimersByTime(60_000);
    expect(logger.info).toHaveBeenLastCalledWith(
      'telemetry.canary',
      expect.objectContaining({ sequence: 2 })
    );
    stop();
  });

  it('warns when the Logtail client is dropping lines', () => {
    const stop = startTelemetryCanary({ service: 'api', intervalMs: 60_000 });
    expect(logger.warn).not.toHaveBeenCalled();

    stats.dropped = 37;
    vi.advanceTimersByTime(60_000);

    expect(logger.warn).toHaveBeenCalledWith(
      'telemetry.canary: log forwarding is dropping lines',
      expect.objectContaining({ droppedDelta: 37, droppedTotal: 37 })
    );
    stop();
  });

  it('warns loudly when no Logtail token is configured', () => {
    stats.logtailConfigured = false;
    const stop = startTelemetryCanary({ service: 'api', intervalMs: 60_000 });

    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('NOT reaching Better Stack'),
      expect.objectContaining({ logtailConfigured: false })
    );
    stop();
  });

  it('stops emitting once stopped', () => {
    const stop = startTelemetryCanary({ service: 'api', intervalMs: 60_000 });
    stop();
    vi.advanceTimersByTime(180_000);
    expect(logger.info).toHaveBeenCalledTimes(1);
  });
});
