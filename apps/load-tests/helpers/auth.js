import { check } from 'k6';
import http from 'k6/http';
import { API_URL, TEST_EMAIL, TEST_PASSWORD } from './config.js';

// Track whether the current VU has authenticated.
// k6 VUs are single-threaded, so this is safe without locks.
let _authenticated = false;

// The Better Auth session token (`name=value`), captured at sign-in and resent
// as an EXPLICIT Cookie header on every request. k6's auto cookie jar does not
// reliably resend the `__Secure-` / SameSite=None token, so /auth/session came
// back without a user; sending it explicitly mirrors a working `curl -b`.
let _sessionCookie = null;

/**
 * The Cookie header (or `{}`) carrying the current VU's session token. Merge
 * into a request's `headers` to authenticate it.
 */
export function sessionCookieHeader() {
  return _sessionCookie ? { Cookie: _sessionCookie } : {};
}

/**
 * Extract the `__Secure-better-auth.session_token=value` cookie string from a
 * sign-in response, or null if it isn't present.
 */
function extractSessionCookie(res) {
  const sc = res.cookies?.['__Secure-better-auth.session_token'];
  if (sc && sc.length > 0 && sc[0].value) {
    return `__Secure-better-auth.session_token=${sc[0].value}`;
  }
  return null;
}

/**
 * Set the session's ACTIVE ORGANIZATION (Better Auth `setActiveOrganization`,
 * persisted on the session row). Org-scoped reads (/leads, /meta-campaigns/...)
 * return `400 No active organization selected` until this runs, so without it
 * the DB-backed scenarios only ever exercise that 400 short-circuit — never the
 * real query path / connection pool. Idempotent; safe to skip on failure.
 *
 * Returns true if an active org is now set.
 */
function setActiveOrg(cookie) {
  const orgsRes = http.get(`${API_URL}/organizations`, {
    headers: { Cookie: cookie },
    tags: { name: 'GET /organizations (setup)' },
  });
  if (orgsRes.status !== 200) return false;

  let orgId = null;
  try {
    orgId = JSON.parse(orgsRes.body)?.organizations?.[0]?.id ?? null;
  } catch {
    return false;
  }
  if (!orgId) return false;

  const setRes = http.post(
    `${API_URL}/organization/active`,
    JSON.stringify({ organizationId: orgId }),
    {
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      tags: { name: 'POST /organization/active (setup)' },
    }
  );
  return setRes.status === 200 || setRes.status === 201;
}

/**
 * Sign in ONCE and set the active org, returning the session-cookie string.
 *
 * Intended for a k6 `setup()` so the whole test signs in a single time and
 * SHARES one cookie across every VU (via useSession() below). This is essential
 * for the heavy scripts: /auth/sign-in is throttled to 30 req/15min per IP
 * (AuthController.signIn), so a per-VU sign-in at 50–200 VUs would 429 most VUs.
 * The cookie is identical for all VUs (one user/session) — fine for load.
 *
 * Returns null on failure so the caller can fail the setup loudly.
 */
export function signInAndSetActiveOrg(
  email = TEST_EMAIL,
  password = TEST_PASSWORD
) {
  const res = http.post(
    `${API_URL}/auth/sign-in`,
    JSON.stringify({ email, password }),
    {
      headers: { 'Content-Type': 'application/json' },
      tags: { name: 'POST /auth/sign-in (setup)' },
    }
  );
  if (res.status !== 200) {
    console.error(
      `setup sign-in failed: ${res.status} ${res.body?.substring(0, 200)}`
    );
    return null;
  }
  const cookie = extractSessionCookie(res);
  if (!cookie) {
    console.error('setup sign-in succeeded but no session_token cookie found');
    return null;
  }
  if (!setActiveOrg(cookie)) {
    // Not fatal for non-org-scoped scenarios, but loud: org-scoped reads will 400.
    console.warn(
      'setup: could not set an active organization — org-scoped reads will 400'
    );
  }
  return cookie;
}

/**
 * Install a shared session cookie (from signInAndSetActiveOrg in setup()) into
 * the current VU. After this, ensureAuthenticated() is a no-op and
 * sessionCookieHeader()/authGet/authPost all use the shared cookie. Cheap;
 * call once per iteration (guarded internally).
 */
export function useSession(cookie) {
  if (cookie && !_authenticated) {
    _sessionCookie = cookie;
    _authenticated = true;
  }
}

/**
 * Ensure the current VU is authenticated. Signs in only once per VU,
 * then reuses the session cookie for all subsequent requests.
 *
 * k6 cookie jars persist across iterations for the same VU,
 * so we only need to sign in once.
 *
 * Returns the VU's cookie jar (always the same object).
 */
export function ensureAuthenticated(
  email = TEST_EMAIL,
  password = TEST_PASSWORD
) {
  const jar = http.cookieJar();

  if (_authenticated) {
    return jar;
  }

  // POST /auth/sign-in is the custom NestJS route (AuthController.signIn),
  // throttled to 30/15min per IP via @Throttle. This is the path the frontend
  // actually calls (apps/app/src/features/auth/use-sign-in.ts -> 'auth/sign-in').
  // (Previously this helper hit '/auth/sign-in/email' — a Better-Auth handler
  //  convention path that is NOT mounted in this API, so it would 404.)
  const res = http.post(
    `${API_URL}/auth/sign-in`,
    JSON.stringify({ email, password }),
    {
      headers: { 'Content-Type': 'application/json' },
      tags: { name: 'POST /auth/sign-in (setup)' },
    }
  );

  const success = check(res, {
    'auth: status 200': (r) => r.status === 200,
    'auth: has session cookie': (r) =>
      r.cookies && Object.keys(r.cookies).length > 0,
  });

  if (!success) {
    console.error(
      `Authentication failed: ${res.status} ${res.body?.substring(0, 200)}`
    );
    return null;
  }

  // Capture the session token (raw, still URL-encoded) for explicit resends.
  const cookie = extractSessionCookie(res);
  if (cookie) {
    _sessionCookie = cookie;
    // Set the active org so org-scoped reads work on this VU's session (see
    // setActiveOrg). NOTE: this per-VU path costs one sign-in per VU; the heavy
    // scripts (wedge/backlog) should instead sign in once in setup() and share
    // the cookie via useSession() to stay under the 30/15min sign-in throttle.
    setActiveOrg(_sessionCookie);
  } else {
    console.error('Sign-in succeeded but no session_token cookie was found');
  }

  _authenticated = true;
  return jar;
}

/**
 * Force a fresh sign-in (for scenarios that specifically test the sign-in path).
 * Use sparingly — the sign-in route is throttled to 30 req/15min per IP
 * (AuthController.signIn @Throttle), so repeated calls will start returning 429.
 */
export function signIn(email = TEST_EMAIL, password = TEST_PASSWORD) {
  const res = http.post(
    `${API_URL}/auth/sign-in`,
    JSON.stringify({ email, password }),
    {
      headers: { 'Content-Type': 'application/json' },
      tags: { name: 'POST /auth/sign-in' },
    }
  );

  check(res, {
    'sign-in: status 200': (r) => r.status === 200,
  });

  return res;
}

/**
 * Make an authenticated GET request
 */
export function authGet(path, params = {}) {
  return http.get(`${API_URL}${path}`, {
    ...params,
    headers: { ...sessionCookieHeader(), ...params.headers },
    tags: { name: path, ...params.tags },
  });
}

/**
 * Make an authenticated POST request
 */
export function authPost(path, body, params = {}) {
  return http.post(`${API_URL}${path}`, JSON.stringify(body), {
    ...params,
    headers: {
      'Content-Type': 'application/json',
      ...sessionCookieHeader(),
      ...params.headers,
    },
    tags: { name: path, ...params.tags },
  });
}

/**
 * Make an authenticated PUT request
 */
export function authPut(path, body, params = {}) {
  return http.put(`${API_URL}${path}`, JSON.stringify(body), {
    ...params,
    headers: {
      'Content-Type': 'application/json',
      ...sessionCookieHeader(),
      ...params.headers,
    },
    tags: { name: path, ...params.tags },
  });
}

/**
 * Make an authenticated DELETE request
 */
export function authDelete(path, params = {}) {
  return http.del(`${API_URL}${path}`, null, {
    ...params,
    headers: { ...sessionCookieHeader(), ...params.headers },
    tags: { name: path, ...params.tags },
  });
}
