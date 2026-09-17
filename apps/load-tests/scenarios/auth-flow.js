import { check, sleep } from 'k6';
import http from 'k6/http';
import { ensureAuthenticated, sessionCookieHeader } from '../helpers/auth.js';
import { API_URL } from '../helpers/config.js';

/**
 * Auth flow scenario: session validation + health checks.
 *
 * Signs in once per VU, then tests the session validation path
 * (which runs on every authenticated request — DB + Redis lookups).
 *
 * Does NOT re-sign-in every iteration to avoid the 10 req/15min
 * rate limit on the sign-in endpoint.
 */
export function authFlow() {
  // Sign in once per VU (no-op on subsequent iterations)
  const jar = ensureAuthenticated();
  if (!jar) return;

  // 1. Validate session (the hot path — every page load does this)
  const sessionRes = http.get(`${API_URL}/auth/session`, {
    headers: sessionCookieHeader(),
    tags: { name: 'GET /auth/session' },
  });

  check(sessionRes, {
    'session: status 200': (r) => r.status === 200,
    'session: has user': (r) => {
      try {
        const body = JSON.parse(r.body);
        return body?.session?.userId || body?.user?.id;
      } catch {
        return false;
      }
    },
  });

  sleep(0.5);

  // 2. Health check (fast, no auth needed)
  const healthRes = http.get(`${API_URL}/health`, {
    tags: { name: 'GET /health' },
  });

  check(healthRes, {
    'health: status 200': (r) => r.status === 200,
  });

  sleep(0.5);

  // 3. Deep health check (DB + Redis)
  const readyRes = http.get(`${API_URL}/health/ready`, {
    tags: { name: 'GET /health/ready' },
  });

  check(readyRes, {
    'health/ready: status 200': (r) => r.status === 200,
  });

  sleep(1);
}
