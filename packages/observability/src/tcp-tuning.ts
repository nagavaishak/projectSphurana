import { existsSync, writeFileSync } from 'node:fs';

/**
 * Tune the kernel's TCP timeouts so a silently-severed outbound connection
 * (Fly's egress NAT black-holes long-lived sockets with no RST/FIN) is detected
 * and killed by the OS in tens of seconds instead of hanging ~indefinitely.
 *
 * Why at this layer
 * -----------------
 * The failure is below the driver: postgres.js / ioredis write onto a dead
 * socket and the kernel retransmits forever, so the query/command never settles
 * and its pooled connection leaks until the process restarts — which saturates
 * the pool. App-layer fixes can't reach this reliably (a postgres.js `socket`
 * factory is neutralised by its TLS upgrade; pg's `query_timeout` rejects the
 * promise but never reaps the connection). The kernel is the one place that
 * works for EVERY outbound TCP connection (Postgres, Redis, external APIs),
 * sits below TLS, and is immune to library internals.
 *
 * How the values map to behaviour
 * -------------------------------
 * - `tcp_retries2` bounds an ACTIVE connection with unacknowledged data (the
 *   mid-query black-hole). Default 15 ≈ 13–30 min. 8 ≈ ~100 s.
 * - `tcp_keepalive_*` bound an IDLE connection. With SO_KEEPALIVE on (postgres.js
 *   sets it via `keep_alive`), the OS starts probing after `time` s idle, then
 *   every `intvl` s, giving up after `probes` failures.
 *
 * Fly Machines are microVMs with their own netns and the app runs as root, so
 * writing `/proc/sys/net/ipv4/*` succeeds (verified on a preview worker). This
 * needs no `sysctl` binary and no shell, so it works in the distroless API too.
 * Every write is independently guarded — a failure (wrong platform, missing
 * capability) is logged and skipped, never fatal.
 */

/** sysctl key -> value. Tunable; validated on a Fly preview before trusting. */
const TCP_TUNING: Readonly<Record<string, string>> = {
  // Active dead-socket bound (~100s instead of ~15min). Conservative against
  // false drops on transient congestion; lower (e.g. 6 ≈ ~50s) for faster
  // recovery if validation shows it's safe.
  'net.ipv4.tcp_retries2': '8',
  // Idle dead-socket detection ≈ time + probes×intvl. 30 + 3×10 = ~60s.
  'net.ipv4.tcp_keepalive_time': '30',
  'net.ipv4.tcp_keepalive_intvl': '10',
  'net.ipv4.tcp_keepalive_probes': '3',
};

export interface TcpTuningResult {
  applied: string[];
  skipped: string[];
}

export interface TcpTuningDeps {
  /** Defaults to `process.platform`. */
  platform?: string;
  /** Defaults to `fs.writeFileSync`. */
  write?: (path: string, value: string) => void;
  /** Defaults to `fs.existsSync`. */
  exists?: (path: string) => boolean;
  /** Defaults to `console.log`. */
  log?: (message: string) => void;
  /** Override the sysctl map (tests). */
  tuning?: Readonly<Record<string, string>>;
}

/**
 * Apply the TCP resilience sysctls. Safe to call unconditionally at process
 * start: a no-op on non-Linux (dev/macOS), and never throws.
 *
 * @returns which keys were applied vs skipped (for logging/tests).
 */
export function applyTcpResilienceTuning(
  deps: TcpTuningDeps = {}
): TcpTuningResult {
  const platform = deps.platform ?? process.platform;
  const write = deps.write ?? ((p, v) => writeFileSync(p, v));
  const exists = deps.exists ?? ((p) => existsSync(p));
  const log = deps.log ?? ((m) => console.log(m));
  const tuning = deps.tuning ?? TCP_TUNING;

  const result: TcpTuningResult = { applied: [], skipped: [] };

  if (platform !== 'linux') {
    // /proc/sys is Linux-only; nothing to do in local dev.
    log(`[tcp-tuning] skipped (platform=${platform}, not linux)`);
    return result;
  }

  for (const [key, value] of Object.entries(tuning)) {
    const path = `/proc/sys/${key.replace(/\./g, '/')}`;
    try {
      if (!exists(path)) {
        result.skipped.push(`${key} (no ${path})`);
        continue;
      }
      write(path, value);
      result.applied.push(`${key}=${value}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      result.skipped.push(`${key} (${message})`);
    }
  }

  if (result.applied.length) {
    log(`[tcp-tuning] applied: ${result.applied.join(', ')}`);
  }
  if (result.skipped.length) {
    // warn-ish: not fatal, but means a connection could still wedge.
    log(`[tcp-tuning] NOT applied: ${result.skipped.join(', ')}`);
  }

  return result;
}
