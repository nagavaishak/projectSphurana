/**
 * Patient-portal transport for the microsite host. COOKIE ONLY.
 *
 * WHAT CHANGED FROM apps/app
 * The version this replaces (apps/app/src/features/patient-portal/api/
 * patient-fetch.ts) carried a dual transport: an httpOnly cookie when the API
 * was same-site, and a 30-day bearer token in `localStorage` when it wasn't.
 * That existed because local Vite, PR previews and native are all cross-site to
 * the API.
 *
 * On a microsite that trade is wrong. These pages render `custom_html` and
 * LLM-authored copy, which makes them the worst place in the estate to keep a
 * long-lived session credential readable from JS. So instead of carrying the
 * token, we remove the reason for it: every request goes to the SAME ORIGIN
 * (`/api/*`), which the Astro proxy forwards to the API. First-party cookie,
 * nothing in `localStorage`, and no per-tenant CORS allowlist to maintain.
 *
 * See src/pages/api/[...path].ts — and note the proxy also strips a
 * `Domain=.borradh.io` cookie attribute, which the browser would otherwise
 * reject outright on a tenant domain.
 *
 * Staff auth is unaffected and keeps its bearer: native has no usable cookie at
 * all (`capacitor://localhost` is cross-site and prod cookies are SameSite=Lax),
 * so that transport is structural, not legacy.
 */

/** Same-origin proxy prefix. Never an absolute API URL — that is the whole point. */
const API_PREFIX = '/api';

export class PatientApiError extends Error {
  constructor(
    message: string,
    public readonly status: number
  ) {
    super(message);
    this.name = 'PatientApiError';
  }
}

interface PatientFetchOptions {
  method?: 'GET' | 'POST';
  body?: unknown;
  /**
   * Which clinic this call is for. The session identifies the PERSON; this
   * names the org, and the API resolves the membership per request.
   *
   * MUST be passed by the caller. The apps/app version parsed it out of
   * `/portal/{slug}/…` in the URL, which cannot work here: under
   * host-implies-org the path is `/portal/bookings` and that regex would match
   * `bookings` — every authenticated call would 401. The Astro page resolves
   * the org (from host, or from the `/sites/{slug}` path tier) and passes it
   * down, so there is exactly one authority instead of the two the old module
   * had to arbitrate between.
   */
  organizationSlug: string;
  /**
   * What a 401 means. `sign-out` is the default. `keep-session` is for calls
   * where a 401 says nothing about the session — the booking prefill asks
   * `/patient/me` for a clinic the customer may simply not be a patient of.
   */
  onUnauthorized?: 'sign-out' | 'keep-session';
}

/** Called when a 401 indicates the session is genuinely gone. */
type SessionExpiredHandler = () => void;
let onSessionExpired: SessionExpiredHandler | null = null;

export function setSessionExpiredHandler(
  fn: SessionExpiredHandler | null
): void {
  onSessionExpired = fn;
}

export async function patientFetch<T>(
  path: string,
  options: PatientFetchOptions
): Promise<T> {
  const { organizationSlug, method = 'GET', body, onUnauthorized } = options;
  if (!organizationSlug) {
    // Loud, not silent: a missing org slug 401s every authenticated call, and
    // that is confusing to debug from the network tab alone.
    throw new PatientApiError('Portal org slug missing for request', 0);
  }

  let response: Response;
  try {
    response = await fetch(`${API_PREFIX}/${path.replace(/^\//, '')}`, {
      method,
      // First-party cookie on this origin. There is no Authorization header
      // here by design — do not add one back.
      credentials: 'same-origin',
      signal: AbortSignal.timeout(30_000),
      headers: {
        'Content-Type': 'application/json',
        'X-Portal-Org': organizationSlug,
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'TimeoutError') {
      throw new PatientApiError('The request timed out — please try again', 0);
    }
    throw new PatientApiError('Could not reach the server', 0);
  }

  if (!response.ok) {
    if (response.status === 401 && onUnauthorized !== 'keep-session') {
      onSessionExpired?.();
    }
    let message = response.statusText || 'Request failed';
    try {
      const data = (await response.json()) as { message?: string | string[] };
      if (data.message) {
        message = Array.isArray(data.message)
          ? data.message.join(', ')
          : data.message;
      }
    } catch {
      // Non-JSON error body — keep the status text.
    }
    throw new PatientApiError(message, response.status);
  }

  const text = await response.text();
  return (text ? JSON.parse(text) : undefined) as T;
}
