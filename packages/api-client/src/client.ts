// @borradh-workspace/api-client - Core HTTP client

import ky, { type KyInstance, type HTTPError, type Options } from 'ky';
import { parseResponse, setResponseParseConfig } from './parse.js';
import type { ApiClientConfig, ApiError, RequestOptions } from './types.js';

let globalConfig: ApiClientConfig | null = null;
let clientInstance: KyInstance | null = null;
let authClientInstance: KyInstance | null = null;

/**
 * Admin org-override. When set (only by the admin panel, via `AdminOrgScope`),
 * requests to the org-scoped feature namespaces below carry an
 * `X-Admin-Organization-Id` header so the API resolves the selected org for
 * `@ActiveOrganization()` endpoints. The backend honors it solely for verified
 * platform admins (read-only); it's ignored for everyone else. Cleared (`null`)
 * when the admin panel unmounts so normal requests are unaffected.
 */
let adminOrgOverride: string | null = null;

/**
 * Path namespaces the admin panel actually reads. The override header is only
 * attached to these, so any other request that happens to be in flight while
 * the panel is open (session, billing, notifications, …) is NEVER redirected
 * to the viewed org — bounding the override's blast radius and preventing
 * cross-org cache bleed into the main app's query cache.
 */
const ADMIN_OVERRIDE_PATH_SEGMENTS = [
  'conversations',
  'meta-campaigns',
  'meta-ads',
];

function shouldAttachOrgOverride(url: string): boolean {
  let pathname: string;
  try {
    pathname = new URL(url).pathname;
  } catch {
    pathname = url;
  }
  return ADMIN_OVERRIDE_PATH_SEGMENTS.some(
    (seg) => pathname.includes(`/${seg}/`) || pathname.endsWith(`/${seg}`)
  );
}

/**
 * Set (or clear, with `null`) the admin org-override sent on org-scoped
 * requests. Intended for the admin panel only.
 */
export function setAdminOrgOverride(organizationId: string | null): void {
  adminOrgOverride = organizationId;
}

/**
 * Active location (branch). When set, EVERY request carries an
 * `X-Location-Id` header and the API scopes location-aware reads and writes to
 * that branch (`LocationGuard` + `@ActiveLocation()`).
 *
 * Unlike the admin override this is NOT path-restricted. The override is a
 * privileged escape hatch whose blast radius has to be bounded; the active
 * location is the ordinary state of the whole app — the user is always looking
 * at exactly one branch — and an endpoint that ignores the header is unchanged
 * by receiving it. A path allowlist here would instead be a list to forget to
 * update every time an endpoint becomes location-aware.
 *
 * `null` (the default) means "no branch selected" and the API falls back to
 * org-wide, which is the behaviour every endpoint had before this existed.
 */
let activeLocationId: string | null = null;

/**
 * Set (or clear, with `null`) the branch every subsequent request is scoped to.
 * Called by the frontend's `use-active-location` seam.
 */
export function setActiveLocationId(locationId: string | null): void {
  activeLocationId = locationId;
}

/** The branch currently being sent on requests, if any. */
export function getActiveLocationId(): string | null {
  return activeLocationId;
}

/**
 * Create a Ky instance with the given configuration
 */
function createClient(config: ApiClientConfig): KyInstance {
  return ky.create({
    prefixUrl: config.baseUrl,
    timeout: config.timeout ?? 30000,
    retry: config.retry ?? 2,
    credentials: 'include', // Required for cross-origin cookies
    headers: config.headers, // Custom headers (e.g., X-Client-Type for mobile)
    hooks: {
      beforeRequest: [
        async (request) => {
          // Add auth header if provider is configured
          if (config.authProvider) {
            const token = await config.authProvider();
            if (token) {
              request.headers.set('Authorization', `Bearer ${token}`);
            }
          }
          // Admin panel only: scope org-namespace requests to the selected org.
          if (adminOrgOverride && shouldAttachOrgOverride(request.url)) {
            request.headers.set('X-Admin-Organization-Id', adminOrgOverride);
          }
          // Active branch. Harmless on org-level endpoints (they never read
          // it), required on every location-scoped one.
          if (activeLocationId) {
            request.headers.set('X-Location-Id', activeLocationId);
          }
        },
      ],
      beforeError: [
        async (error: HTTPError) => {
          const status = error.response.status;
          // For server errors (5xx), never expose internal details to the user
          const isServerError = status >= 500;
          let userMessage = isServerError
            ? 'An unexpected error occurred'
            : error.response.statusText;
          let errorCode: string | undefined;
          let errorDetails: Record<string, unknown> | undefined;

          if (!isServerError) {
            try {
              const body = (await error.response.clone().json()) as Record<
                string,
                unknown
              >;
              // Handle Result<T> error format from features package
              if (body.error && typeof body.error === 'object') {
                const errorObj = body.error as Record<string, unknown>;
                userMessage = (errorObj.message as string) || userMessage;
              } else if (typeof body.message === 'string') {
                // Handle simple { message: string } format
                userMessage = body.message;
              }
              // Extract error code and details for structured error handling
              if (typeof body.code === 'string') {
                errorCode = body.code;
              }
              if (body.details && typeof body.details === 'object') {
                errorDetails = body.details as Record<string, unknown>;
              }
            } catch {
              // Response is not JSON, use status text
            }
          }

          // Call global error handler if configured
          if (config.onError) {
            const apiError: ApiError = {
              status,
              message: userMessage,
              code: errorCode,
              details: errorDetails,
            };
            config.onError(apiError);
          }

          // Replace ky's verbose message with the user-friendly one
          error.message = userMessage;

          // Attach structured error info to the error object so consumers
          // (e.g., React Query onError) can access code + details
          (
            error as HTTPError & {
              code?: string;
              details?: Record<string, unknown>;
            }
          ).code = errorCode;
          (
            error as HTTPError & {
              code?: string;
              details?: Record<string, unknown>;
            }
          ).details = errorDetails;
          return error;
        },
      ],
    },
  });
}

/**
 * Get the current client instance
 * Throws if configureApiClient() hasn't been called
 */
function getClient(): KyInstance {
  if (!clientInstance) {
    throw new Error(
      'API client not configured. Call configureApiClient() first.'
    );
  }
  return clientInstance;
}

/**
 * Check if a path is an auth endpoint
 */
function isAuthPath(path: string): boolean {
  return path.startsWith('auth/') || path.startsWith('auth');
}

/**
 * Get the appropriate client for the given path
 * Uses authClient for auth/* paths when authUrl is configured
 */
function getClientForPath(path: string): KyInstance {
  if (isAuthPath(path) && authClientInstance) {
    return authClientInstance;
  }
  return getClient();
}

/**
 * Configure the global API client
 * Call this once in your app's initialization
 *
 * @example
 * ```typescript
 * // Web app with Next.js rewrite + external API
 * configureApiClient({
 *   baseUrl: '/api',  // Uses Next.js rewrite
 *   authUrl: 'https://api.example.com/api',  // Direct API for auth (bypasses rewrite)
 * });
 *
 * // React Native app (no rewrite needed)
 * configureApiClient({
 *   baseUrl: 'https://api.example.com/api',
 *   authProvider: async () => session?.accessToken,
 * });
 * ```
 */
export function configureApiClient(config: ApiClientConfig): void {
  globalConfig = config;
  clientInstance = createClient(config);
  // Register response-parse controls (mode/kill-switch/telemetry). Safe default
  // (report + console) applies when `responseParse` is omitted.
  setResponseParseConfig(config.responseParse ?? {});

  // Create separate auth client if authUrl is provided
  // This is needed for web apps using Next.js rewrites because
  // rewrites don't forward Set-Cookie headers from external origins
  if (config.authUrl) {
    authClientInstance = createClient({
      ...config,
      baseUrl: config.authUrl,
    });
  } else {
    authClientInstance = null;
  }
}

/**
 * Get the current API client configuration
 */
export function getApiClientConfig(): ApiClientConfig | null {
  return globalConfig;
}

/**
 * API client with typed HTTP methods
 *
 * @example
 * ```typescript
 * // GET request
 * const user = await apiClient.get<User>('/users/123');
 *
 * // POST request
 * const result = await apiClient.post<CreateUserResult>('/users', {
 *   email: 'user@example.com',
 *   name: 'John Doe',
 * });
 * ```
 */
/**
 * Split a request's options into the response `schema` (consumed by api-client)
 * and the rest (forwarded to ky, which must not see the unknown `schema` key).
 */
function splitSchema<T>(options?: RequestOptions<T>): {
  schema?: RequestOptions<T>['schema'];
  kyOptions?: Omit<Options, 'json'>;
} {
  if (!options) return {};
  const { schema, ...kyOptions } = options;
  return { schema, kyOptions };
}

export const apiClient = {
  /**
   * Make a GET request.
   *
   * Pass `{ schema }` to validate the response against a contracts schema at
   * runtime (report mode by default — a mismatch is logged, not thrown).
   */
  async get<T>(path: string, options?: RequestOptions<T>): Promise<T> {
    const { schema, kyOptions } = splitSchema(options);
    const data = await getClientForPath(path).get(path, kyOptions).json<T>();
    return parseResponse(path, data, schema);
  },

  /**
   * Make a POST request
   * Note: Retries are disabled by default for mutations to prevent duplicate submissions
   */
  async post<T>(
    path: string,
    data?: unknown,
    options?: RequestOptions<T>
  ): Promise<T> {
    const { schema, kyOptions } = splitSchema(options);
    const response = await getClientForPath(path)
      .post(path, { json: data, retry: 0, ...kyOptions })
      .json<T>();
    return parseResponse(path, response, schema);
  },

  /**
   * Make a POST request with multipart/form-data body (for file uploads)
   * Note: Retries are disabled by default for mutations to prevent duplicate submissions
   */
  async postMultipart<T>(
    path: string,
    formData: FormData,
    query?: Record<string, string | undefined>,
    options?: RequestOptions<T>
  ): Promise<T> {
    const { schema, kyOptions } = splitSchema(options);
    const searchParams: Record<string, string> = {};
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined) searchParams[key] = value;
      }
    }
    const response = await getClientForPath(path)
      .post(path, {
        body: formData,
        retry: 0,
        ...(Object.keys(searchParams).length > 0 ? { searchParams } : {}),
        ...kyOptions,
      })
      .json<T>();
    return parseResponse(path, response, schema);
  },

  /**
   * Make a PUT request
   * Note: Retries are disabled by default for mutations to prevent duplicate submissions
   */
  async put<T>(
    path: string,
    data?: unknown,
    options?: RequestOptions<T>
  ): Promise<T> {
    const { schema, kyOptions } = splitSchema(options);
    const response = await getClientForPath(path)
      .put(path, { json: data, retry: 0, ...kyOptions })
      .json<T>();
    return parseResponse(path, response, schema);
  },

  /**
   * Make a PATCH request
   * Note: Retries are disabled by default for mutations to prevent duplicate submissions
   */
  async patch<T>(
    path: string,
    data?: unknown,
    options?: RequestOptions<T>
  ): Promise<T> {
    const { schema, kyOptions } = splitSchema(options);
    const response = await getClientForPath(path)
      .patch(path, { json: data, retry: 0, ...kyOptions })
      .json<T>();
    return parseResponse(path, response, schema);
  },

  /**
   * Make a DELETE request, optionally with a JSON body.
   * Note: Retries are disabled by default for mutations to prevent duplicate submissions
   */
  async delete<T>(
    path: string,
    data?: unknown,
    options?: RequestOptions<T>
  ): Promise<T> {
    const { schema, kyOptions } = splitSchema(options);
    const response = await getClientForPath(path)
      .delete(path, { json: data, retry: 0, ...kyOptions })
      .json<T>();
    return parseResponse(path, response, schema);
  },
};
