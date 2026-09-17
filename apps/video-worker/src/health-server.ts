import { type Server, createServer } from 'node:http';
import type { Logger } from '@borradh-workspace/observability';
import type { Redis } from '@borradh-workspace/redis';

/**
 * Worker liveness HTTP server.
 *
 * The video worker has no public HTTP surface, so until now nothing watched the
 * process except the BetterStack heartbeat — which only *alerts*, it doesn't
 * recover. When the Fly machine's Redis/socket connections were severed (Fly NAT
 * killing idle connections during/after slow renders) the node process wedged:
 * it stopped draining the queue and stopped heartbeating without exiting, and
 * Fly left it `started` because the `worker` process group had no health check.
 * Recovery required a manual `flyctl machine restart`.
 *
 * This server gives Fly something to probe (top-level `[checks]` in fly.toml).
 * It reports unhealthy — so Fly recycles the machine automatically — when:
 *
 * 1. The event loop is wedged. The HTTP handler simply stops responding, so the
 *    Fly check times out. This is the case that caused the 2026-06-14 incident.
 * 2. The internal liveness ticker has gone stale. A short `setInterval` stamps a
 *    timestamp; if the loop was blocked long enough that the stamp is older than
 *    `STALE_TICK_MS`, we know the process was unresponsive even if it has since
 *    recovered enough to answer this request.
 * 3. The Redis (BullMQ) connection is not `ready`. A severed-but-not-reconnected
 *    socket means the worker can't pull jobs — surface it as unhealthy so Fly
 *    recycles rather than leaving a silently non-draining worker.
 */

// How often the internal liveness ticker stamps the clock.
const TICK_INTERVAL_MS = 15_000;
// If the last tick is older than this, the event loop was blocked — unhealthy.
// Generous enough that a long synchronous step (e.g. ffmpeg spawn) won't trip it,
// tight enough that a true wedge is caught well before the heartbeat alert fires.
const STALE_TICK_MS = 90_000;

export interface HealthServerHandle {
  server: Server;
  close: () => Promise<void>;
}

/**
 * Start the liveness HTTP server and the internal liveness ticker.
 *
 * @param redis  The BullMQ Redis client whose connection status gates liveness.
 * @param log    Logger for startup/shutdown messages.
 * @param port   Internal port Fly's health check targets. Defaults to
 *   `WORKER_HEALTH_PORT` (8080 if unset). Deliberately NOT the shared `PORT`
 *   env: locally the worker loads the same root `.env` as the API, and `PORT`
 *   there is the API's (3000) — inheriting it made the worker's liveness server
 *   collide with the API on `:3000` under `pnpm dev`.
 */
export function startHealthServer(
  redis: Redis,
  log: Logger,
  port = Number.parseInt(process.env.WORKER_HEALTH_PORT || '8080', 10)
): HealthServerHandle {
  let lastTick = Date.now();
  const ticker = setInterval(() => {
    lastTick = Date.now();
  }, TICK_INTERVAL_MS);
  // Don't let the ticker keep the process alive on its own during shutdown.
  ticker.unref();

  const server = createServer((req, res) => {
    if (req.url !== '/health' && req.url !== '/health/live') {
      res.writeHead(404).end('not found');
      return;
    }

    const tickAgeMs = Date.now() - lastTick;
    const eventLoopStale = tickAgeMs > STALE_TICK_MS;
    // ioredis status is 'ready' once connected and handshaked. 'connecting'/
    // 'reconnecting' are transient and tolerated; only a non-ready status that
    // persists past the Fly grace period should fail the check.
    const redisReady = redis.status === 'ready';
    const healthy = !eventLoopStale && redisReady;

    const body = JSON.stringify({
      status: healthy ? 'ok' : 'unhealthy',
      redisStatus: redis.status,
      eventLoopTickAgeMs: tickAgeMs,
      eventLoopStale,
    });

    res.writeHead(healthy ? 200 : 503, {
      'content-type': 'application/json',
    });
    res.end(body);
  });

  server.listen(port, () => {
    log.info(`Worker health server listening on :${port} (GET /health)`);
  });

  server.on('error', (err) => {
    log.error('Worker health server error', {
      error: err instanceof Error ? err.message : String(err),
    });
  });

  const close = () =>
    new Promise<void>((resolve) => {
      clearInterval(ticker);
      server.close(() => resolve());
    });

  return { server, close };
}
