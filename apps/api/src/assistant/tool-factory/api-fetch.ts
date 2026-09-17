import type { ZodType, z } from 'zod';
import { sanitizeApiError } from './error-sanitization.js';
import { isPathAllowed } from './path-whitelist.js';

export interface ApiFetchOptions {
  method?: string;
  body?: unknown;
  /**
   * Response schema. When supplied, the decoded body is PARSED against it and
   * the parsed value is returned; a mismatch throws `ApiResponseContractError`.
   *
   * Supply one whenever `packages/contracts/src/responses/` already declares
   * the endpoint's shape. Without it the return type is whatever the caller
   * asserts, which is not a check — see the note on `ApiFetchFn`.
   */
  schema?: ZodType;
}

/**
 * Error thrown by `apiFetch` when the internal API responds with a non-2xx
 * status. Carries the HTTP `status` so callers can distinguish expected
 * client-facing conditions (4xx — auth/validation/not-found, which are normal
 * tool outcomes the model should see and react to) from genuine server faults
 * (5xx) worth capturing to Sentry. `message` is already sanitized.
 */
export class ApiFetchError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiFetchError';
    this.status = status;
  }
}

/**
 * Thrown when a response does not match the `schema` the caller declared.
 *
 * Distinct from `ApiFetchError` on purpose: that one means the API said no,
 * which is a normal tool outcome the model should see and react to. This one
 * means the API said yes and returned something the caller cannot read — a
 * defect in this repo, not a condition the model can do anything about.
 *
 * It is thrown rather than swallowed because the alternative is what shipped:
 * `meta_ads_generateAdCopy` asserted `{ headline }` on an envelope that nests
 * the copy under `content`, so every field read `undefined`, and the tool
 * returned `{ headline: null, primaryText: null, description: null }` with an
 * OK status on 100% of calls for months. Returning a degraded value is exactly
 * how that stayed invisible.
 */
export class ApiResponseContractError extends Error {
  readonly path: string;
  /** Zod's issue list, already flattened to `path: message` lines. */
  readonly issues: readonly string[];

  constructor(path: string, issues: readonly string[]) {
    super(
      `Response from "${path}" did not match its declared schema: ${issues.join('; ')}`
    );
    this.name = 'ApiResponseContractError';
    this.path = path;
    this.issues = issues;
  }
}

/**
 * The loopback fetcher handed to every tool.
 *
 * TWO CALL FORMS, and the difference is the whole point:
 *
 *   apiFetch<Thing>('things/1')                    // asserted — NOT checked
 *   apiFetch('things/1', { schema: thingSchema })  // parsed — checked
 *
 * The first is the caller telling the compiler what comes back, with nothing
 * connecting the type parameter to the endpoint. It remains available because
 * ~100 call sites use it and most endpoints have no declared response schema
 * yet, but it is a promise, not a guarantee. Prefer the second wherever
 * `packages/contracts/src/responses/` already declares the shape.
 */
export type ApiFetchFn = {
  <S extends ZodType>(
    path: string,
    options: ApiFetchOptions & { schema: S }
  ): Promise<z.output<S>>;
  <T = unknown>(path: string, options?: ApiFetchOptions): Promise<T>;
};

/**
 * Internal service-auth credentials for the loopback acts-as path. When set,
 * `createApiFetch` sends the `x-internal-service-token` + acts-as headers the
 * `AuthGuard` honors over loopback, INSTEAD of a session cookie. Used by the
 * Claire WhatsApp worker, which has no browser session.
 */
export interface InternalAuthConfig {
  token: string;
  userId: string;
  organizationId: string;
}

export interface CreateApiFetchConfig {
  /** Cookie header forwarded from the originating chat request (carries the
   *  user session). Internal API calls live on `localhost:${port}` and need
   *  the same auth context the assistant chat request had. Mutually exclusive
   *  with `internalAuth` — the web path sets this. */
  cookie?: string;
  /** Authorization header forwarded from the originating web request. The
   *  frontend can authenticate with a bearer token instead of a session
   *  cookie, so loopback tool calls must preserve either web auth form. */
  authorization?: string;
  /** Internal service-auth (loopback acts-as). Set by the WhatsApp worker
   *  instead of `cookie`. When present, internal-auth headers are sent and the
   *  cookie is omitted. */
  internalAuth?: InternalAuthConfig;
  /** Port of the local NestJS API (the same process — internal hop). */
  port: number;
  /**
   * Branch this turn is scoped to. Forwarded as `X-Location-Id` on every
   * internal hop so Claire's tools read the SAME location-scoped catalogue,
   * calendar and prices the human in that branch sees.
   *
   * This is the whole of Claire's location correctness: her tools do not query
   * the database, they call the same HTTP endpoints the app does, so scoping
   * her is scoping the hop. Without it she would list Dublin's services and
   * quote Dublin's price to a Cork customer (plan §3.3 / risk 1).
   *
   * Undefined = no branch, which is org-wide — identical to today.
   */
  locationId?: string;
  /** Per-tool whitelist extension. Composed with the shared whitelist; the
   *  shared one isn't mutated. */
  additionalAllowedPaths?: readonly RegExp[];
}

/**
 * Build an `apiFetch` for a tool's execution.
 *
 * The factory composes the shared path whitelist with the tool's optional
 * `additionalAllowedPaths`. Errors from the internal API are sanitized
 * before being thrown (callers see a user-safe message, never SQL/stack
 * traces/connection details).
 */
export function createApiFetch(config: CreateApiFetchConfig): ApiFetchFn {
  const {
    cookie,
    authorization,
    internalAuth,
    port,
    locationId,
    additionalAllowedPaths,
  } = config;

  // The auth headers are fixed for the lifetime of this fetcher: the
  // originating cookie/bearer credentials, or worker acts-as headers.
  const authHeaders: Record<string, string> = internalAuth
    ? {
        'x-internal-service-token': internalAuth.token,
        'x-acts-as-user-id': internalAuth.userId,
        'x-acts-as-organization-id': internalAuth.organizationId,
      }
    : {
        ...(cookie ? { cookie } : {}),
        ...(authorization ? { authorization } : {}),
      };

  // Rides alongside auth on every hop. `LocationGuard` re-validates it against
  // the acting org — an assistant turn gets no more trust than a browser.
  if (locationId) {
    authHeaders['x-location-id'] = locationId;
  }

  const fetcher = async (
    path: string,
    options?: ApiFetchOptions
  ): Promise<unknown> => {
    if (!isPathAllowed(path, additionalAllowedPaths)) {
      // Generic message — never reveal that path checking exists or which
      // paths are allowed.
      throw new Error('This action is not available.');
    }

    const fetchRes = await fetch(`http://localhost:${port}/${path}`, {
      method: options?.method ?? 'GET',
      headers: {
        ...authHeaders,
        ...(options?.body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(options?.body ? { body: JSON.stringify(options.body) } : {}),
    });

    if (!fetchRes.ok) {
      const errBody = (await fetchRes.json().catch(() => ({
        message: fetchRes.statusText,
      }))) as { message?: string; error?: string };
      const rawMessage =
        errBody.message ?? errBody.error ?? `API error ${fetchRes.status}`;
      throw new ApiFetchError(
        sanitizeApiError(rawMessage, fetchRes.status),
        fetchRes.status
      );
    }

    const body: unknown = await fetchRes.json();

    const { schema } = options ?? {};
    if (!schema) return body;

    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      throw new ApiResponseContractError(
        path,
        parsed.error.issues.map(
          (issue) =>
            `${issue.path.length > 0 ? issue.path.join('.') : '(root)'}: ${issue.message}`
        )
      );
    }
    return parsed.data;
  };

  return fetcher as ApiFetchFn;
}
