// @borradh-workspace/api-client - Schema-aware response parsing
//
// Optional runtime validation of API responses against a Zod schema (the
// contracts package). Two modes, gated by the app's flag system:
//
//   report (default) — on a parse failure, log { endpoint, zodError } to the
//                      app's telemetry and RETURN THE RAW DATA (non-fatal).
//   strict           — throw, surfacing the mismatch as a React Query error.
//
// This module is dependency-free: it accepts any object with a Zod-compatible
// `safeParse` (so api-client never imports `zod`/`contracts`), and it takes the
// mode/kill-switch/telemetry as injected resolvers on the client config. The
// frontend wires those to its own flag system (`isFeatureOn`-equivalent +
// global kill-switch); the safe default is report with console logging.

/**
 * Structural, zod-compatible schema shape. A Zod schema satisfies this exactly,
 * so callers pass `leadDetailSchema` etc. without api-client depending on zod.
 */
export interface ResponseSchema<T> {
  safeParse(
    data: unknown
  ): { success: true; data: T } | { success: false; error: unknown };
}

/** Context handed to the telemetry hook when a response fails to parse. */
export interface ResponseParseErrorInfo {
  /** The request path the response came from. */
  endpoint: string;
  /** The ZodError (or whatever the schema's safeParse returned as `error`). */
  error: unknown;
}

/**
 * Injected controls for response parsing. All optional; omitting them yields the
 * safe default: report mode, console logging, kill-switch off.
 */
export interface ResponseParseConfig {
  /**
   * Resolve STRICT mode. Return `true` to throw on mismatch, `false` (default)
   * to report-and-pass-through. Wire this to `isFeatureOn('response-parse-strict')`.
   */
  isStrict?: () => boolean;
  /**
   * Global kill-switch. Return `true` to skip parsing entirely (raw passthrough)
   * regardless of `isStrict`. Wire this to the global kill-switch flag.
   */
  killSwitch?: () => boolean;
  /** Telemetry hook for report-mode failures (Sentry/PostHog on the frontend). */
  onParseError?: (info: ResponseParseErrorInfo) => void;
}

let parseConfig: ResponseParseConfig = {};

/** Set the global response-parse config (called from configureApiClient). */
export function setResponseParseConfig(config: ResponseParseConfig): void {
  parseConfig = config ?? {};
}

function defaultReport(info: ResponseParseErrorInfo): void {
  // Safe fallback when the app hasn't wired telemetry. Never throws.
  // eslint-disable-next-line no-console
  console.error(
    `[api-client] response failed schema validation for "${info.endpoint}"`,
    info.error
  );
}

/** Error thrown in strict mode when a response doesn't match its schema. */
export class ResponseParseError extends Error {
  readonly endpoint: string;
  readonly zodError: unknown;
  constructor(endpoint: string, zodError: unknown) {
    super(`Response from "${endpoint}" failed schema validation`);
    this.name = 'ResponseParseError';
    this.endpoint = endpoint;
    this.zodError = zodError;
  }
}

/**
 * An endpoint that returns `null` (Nest serializes it as a 200 with an empty
 * body, as does any 204) comes back from ky's `.json()` as the empty string,
 * NOT as `null` — and `'' ?? fallback` keeps the `''`. Callers type these
 * endpoints as `T | null` and branch on nullishness, so `''` silently reads as
 * "a session exists" / "an object exists" and every field on it is `undefined`.
 * Normalize it once, here, where every verb funnels through.
 */
function normalizeEmptyBody<T>(data: T): T {
  return ((data as unknown) === '' ? null : data) as T;
}

/**
 * Parse `data` against `schema` if present, applying the configured mode.
 * Backward compatible: with no schema, returns `data` unchanged (bar the
 * empty-body → `null` normalization above).
 */
export function parseResponse<T>(
  endpoint: string,
  rawData: T,
  schema?: ResponseSchema<T>
): T {
  const data = normalizeEmptyBody(rawData);
  if (!schema) return data;

  // Kill-switch: skip parsing entirely.
  try {
    if (parseConfig.killSwitch?.()) return data;
  } catch {
    // A flag-eval blip must never break the request — fall through to parse.
  }

  let strict = false;
  try {
    strict = parseConfig.isStrict?.() ?? false;
  } catch {
    strict = false; // degrade to the safe default (report).
  }

  const result = schema.safeParse(data);
  if (result.success) {
    // Strict mode returns the validated value; report mode returns the RAW data
    // unchanged. Zod strips unknown keys on parse, so returning `result.data` in
    // report mode could silently drop fields an incomplete projection didn't
    // model — report must be fully behavior-preserving vs the old `.json<T>()`.
    return strict ? result.data : data;
  }

  if (strict) {
    throw new ResponseParseError(endpoint, result.error);
  }

  // Report mode: log and pass the raw data through (non-fatal).
  const report = parseConfig.onParseError ?? defaultReport;
  try {
    report({ endpoint, error: result.error });
  } catch {
    // Telemetry must never break the request.
  }
  return data;
}
