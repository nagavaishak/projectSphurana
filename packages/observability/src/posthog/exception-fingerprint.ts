/**
 * Fallback grouping for backend `$exception` events with NO in-app stack
 * frame anywhere in the cause chain (ENG-851).
 *
 * PostHog's default fingerprint walks the FIRST exception's stack frames and
 * (per https://posthog.com/docs/error-tracking/fingerprints) falls back to
 * "add the first frame" only when there are NO in-app frames at all. In the
 * deployed API bundle, driver errors (postgres.js `PostgresError`, Stripe's
 * SDK errors) are born inside `node_modules/`, so every frame on them is
 * `in_app: false` — and so is every frame belonging to OUR OWN workspace
 * packages, because they resolve on disk under
 * `node_modules/.pnpm/@borradh-workspace+*` (see the `before_send` hook in
 * `./client.ts` for the case that DOES fix). When a caller has no app frame
 * anywhere — e.g. an error that never crosses into `apps/api/src` — every
 * distinct fault collapses onto the same first-internal-frame fingerprint
 * (`TLSWrap.callbackTrampoline`, `process.processTicksAndRejections`, …).
 *
 * This module answers ONE question — "does any frame in this error or its
 * cause chain look like our code?" — from the plain `Error#stack` string, so
 * `logError` can decide whether to set `$exception_fingerprint` as a fallback.
 * It intentionally does NOT touch the SDK's own frame-based grouping when an
 * app frame DOES exist — that grouping is strictly better (it groups by the
 * actual call site, not just error type + code).
 */

/** Matches a path segment that is unambiguously part of this repo's code. */
const APP_PATH_MARKERS: RegExp[] = [
  /\/apps\//,
  /\/packages\//,
  // pnpm's on-disk store directory for OUR workspace packages, e.g.
  // `node_modules/.pnpm/@borradh-workspace+features@0.0.1/node_modules/...`
  // — this IS app code even though the path also contains `node_modules/`.
  /@borradh-workspace\+/,
  // What a resolved frame looks like in dev/ts-node/vitest runs (relative
  // import from a compiled/mapped location back to source).
  /\.\.\/\.\.\/src\//,
];

/**
 * True when a single stack trace line points at app code (this repo), false
 * for vendor/dependency code and node internals.
 */
export const isAppCodeStackLine = (line: string): boolean => {
  if (!APP_PATH_MARKERS.some((marker) => marker.test(line))) return false;

  // A `node_modules/` segment is vendor code UNLESS it's actually one of our
  // OWN workspace packages resolved through pnpm's `.pnpm` store (which also
  // matches `/packages/` and `@borradh-workspace+` above) — exclude every
  // other node_modules line even if it happens to contain `/packages/` or
  // `/apps/` as a substring of some third-party path.
  if (line.includes('node_modules/') && !line.includes('@borradh-workspace+')) {
    return false;
  }

  return true;
};

const MAX_CAUSE_DEPTH = 10;

/**
 * Walks `error` and its `.cause` chain (matching the depth the SDK itself
 * serializes, see `MAX_CAUSE_RECURSION` in `@posthog/core`'s
 * error-properties-builder) and returns true if ANY stack trace, anywhere in
 * the chain, contains a line that looks like app code.
 */
export const hasAppStackFrame = (error: unknown, depth = 0): boolean => {
  if (depth > MAX_CAUSE_DEPTH || !(error instanceof Error)) return false;

  const stack = error.stack;
  if (typeof stack === 'string' && stack.split('\n').some(isAppCodeStackLine)) {
    return true;
  }

  return hasAppStackFrame(error.cause, depth + 1);
};

/**
 * Builds a `$exception_fingerprint` string (PostHog's grouping-override
 * property is a plain String — see
 * https://posthog.com/docs/error-tracking/capture#customizing-exception-capture)
 * from stable, low-cardinality parts so distinct faults with no in-app frame
 * still land in distinct issues instead of one bucket keyed on a random node
 * internal frame.
 *
 * Parts that are missing/empty are dropped rather than serialized as
 * "undefined" — keeps fingerprints readable and stable if a caller omits one.
 */
export const buildFallbackFingerprint = (
  operation: string,
  errorName: string,
  code?: string | null
): string =>
  [operation, errorName, code]
    .filter(
      (part): part is string => typeof part === 'string' && part.length > 0
    )
    .join(':');
