/**
 * Transient connection-error retry for Postgres queries.
 *
 * Neon (and any networked Postgres behind Fly) occasionally drops a pooled TCP
 * connection out from under the client — a proxy recycle, an `admin_shutdown`,
 * or a silent network blip. `postgres.js` doesn't know the socket is dead until
 * it uses it, so the next query fails with `CONNECTION_CLOSED` / `ECONNRESET`
 * (or hangs until a timeout). A single retry on a *fresh* connection almost
 * always succeeds, which is exactly what Neon's "Building resilient applications
 * with Postgres" guide prescribes:
 *   - retry only transient connection errors,
 *   - exponential backoff with jitter.
 *
 * This is a thin, dependency-free wrapper so callers can opt-in around any DB
 * call (`withDbRetry(() => db.query...())`). It does NOT retry on application or
 * constraint errors — only the connection-level codes below.
 */

/** Postgres SQLSTATE codes for connection-class failures (class 08 + admin shutdown). */
const TRANSIENT_SQLSTATES = new Set([
  '57P01', // admin_shutdown — server/proxy closing the connection
  '08000', // connection_exception
  '08001', // sqlclient_unable_to_establish_sqlconnection
  '08003', // connection_does_not_exist
  '08004', // sqlserver_rejected_establishment_of_sqlconnection
  '08006', // connection_failure
  '08007', // transaction_resolution_unknown
]);

/** postgres.js + node socket error codes that mean the connection died. */
const TRANSIENT_CODES = new Set([
  'CONNECTION_CLOSED',
  'CONNECTION_ENDED',
  'CONNECTION_DESTROYED',
  // postgres.js emits 'CONNECT_TIMEOUT' (not 'CONNECTION_CONNECT_TIMEOUT')
  // when a new connection can't be established in connect_timeout — the exact
  // code seen when the Fly worker hits a cold/suspended Neon compute. Both
  // spellings are listed so neither slips through.
  'CONNECT_TIMEOUT',
  'CONNECTION_CONNECT_TIMEOUT',
  'ECONNRESET',
  'ECONNREFUSED',
  'EPIPE',
  'ETIMEDOUT',
  'ENETUNREACH',
  'EHOSTUNREACH',
]);

// `cannot read properties of null (reading 'write')` is the postgres.js error
// thrown from connection.js `nextWrite` when a query is dispatched onto a
// connection whose socket was already torn down — the canonical symptom of
// Fly's NAT silently severing an idle pooled connection (e.g. while a request
// awaits a slow external API between DB calls). The write never reached the
// server, so retrying on a fresh connection is safe. This error carries no
// `code`, so it can only be matched by message.
const TRANSIENT_MESSAGE =
  /CONNECTION_CLOSED|CONNECTION_ENDED|CONNECTION_DESTROYED|CONNECT_TIMEOUT|ECONNRESET|EPIPE|ETIMEDOUT|connection (?:closed|terminated|reset|failure)|terminating connection|server closed the connection|the database system is (?:starting up|shutting down)|cannot read properties of null \(reading 'write'\)/i;

/**
 * Is this error a transient connection failure that's safe to retry?
 *
 * Checks the error AND its `cause` — drizzle-orm wraps the underlying
 * `postgres.js` error ("Failed query: …") and carries the real error (with its
 * `code`) on `err.cause`.
 */
export function isTransientDbError(error: unknown): boolean {
  const candidates = [error, (error as { cause?: unknown } | null)?.cause];
  for (const candidate of candidates) {
    if (!candidate) continue;
    const code = (candidate as { code?: unknown }).code;
    if (
      typeof code === 'string' &&
      (TRANSIENT_SQLSTATES.has(code) || TRANSIENT_CODES.has(code))
    ) {
      return true;
    }
    const message = (candidate as { message?: unknown }).message;
    if (typeof message === 'string' && TRANSIENT_MESSAGE.test(message)) {
      return true;
    }
  }
  return false;
}

export interface DbRetryOptions {
  /** Max retry attempts after the initial try (default 5). */
  retries?: number;
  /** Exponential multiplier (default 2). */
  factor?: number;
  /** Base delay for the first retry, ms (default 1000). */
  minDelayMs?: number;
  /** Cap for any single backoff, ms (default 16000). */
  maxDelayMs?: number;
  /**
   * Per-attempt timeout, ms. If a single attempt doesn't settle in time it's
   * rejected as a transient `CONNECTION_CONNECT_TIMEOUT` and retried on a fresh
   * connection. This is what turns a *silent hang* — e.g. Neon's PgBouncer
   * holding the client socket open while a scaled-to-zero compute wakes — into
   * a fast, retryable error. Without it, `withDbRetry` only retries *thrown*
   * errors, so a hang just burns the caller's entire timeout budget. Off by
   * default; opt in for latency-sensitive callers (the readiness probe).
   */
  attemptTimeoutMs?: number;
  /** Observability hook fired before each retry sleep. */
  onRetry?: (error: unknown, attempt: number, delayMs: number) => void;
}

/**
 * Race `fn()` against a timeout that rejects with a transient connection error,
 * so a hung attempt is retried on a fresh connection instead of hanging. The
 * underlying query isn't cancelled (postgres.js exposes no cancel here); the
 * server-side `statement_timeout` reaps it and the next attempt uses a new
 * pooled connection.
 */
function withAttemptTimeout<T>(fn: () => Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const error = new Error(`DB attempt exceeded ${ms}ms`);
      (error as { code?: string }).code = 'CONNECTION_CONNECT_TIMEOUT';
      reject(error);
    }, ms);
  });
  return Promise.race([fn(), timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

/**
 * Run `fn`, retrying ONLY on transient connection errors with exponential
 * backoff + jitter. Non-transient errors (constraint violations, app errors)
 * throw immediately on the first failure.
 *
 * Defaults follow Neon's guide (retries 5, factor 2, 1s → 16s). Pass tighter
 * params for latency-sensitive callers (e.g. the readiness probe, which has an
 * 8s budget: `{ retries: 2, minDelayMs: 100, maxDelayMs: 400 }`).
 */
export async function withDbRetry<T>(
  fn: () => Promise<T>,
  options: DbRetryOptions = {}
): Promise<T> {
  const {
    retries = 5,
    factor = 2,
    minDelayMs = 1000,
    maxDelayMs = 16000,
    attemptTimeoutMs,
    onRetry,
  } = options;

  const runAttempt = attemptTimeoutMs
    ? () => withAttemptTimeout(fn, attemptTimeoutMs)
    : fn;

  let attempt = 0;
  for (;;) {
    try {
      return await runAttempt();
    } catch (error) {
      if (attempt >= retries || !isTransientDbError(error)) throw error;
      // Exponential backoff with jitter over the upper half of the window, so
      // multiple instances don't retry in lockstep.
      const ceiling = Math.min(maxDelayMs, minDelayMs * factor ** attempt);
      const delayMs = Math.floor(ceiling / 2 + Math.random() * (ceiling / 2));
      attempt += 1;
      onRetry?.(error, attempt, delayMs);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}
