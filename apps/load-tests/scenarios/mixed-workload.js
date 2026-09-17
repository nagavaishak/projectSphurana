import { check, sleep } from 'k6';
import http from 'k6/http';
import {
  authGet,
  ensureAuthenticated,
  sessionCookieHeader,
} from '../helpers/auth.js';
import { API_URL } from '../helpers/config.js';

/**
 * Mixed workload scenario: realistic traffic proportions.
 *
 * Simulates a realistic mix of what the API handles:
 *   40% - health/session checks (every page load)
 *   30% - list operations (browsing)
 *   20% - single entity reads (detail pages)
 *   10% - writes (creates, updates)
 */
export function mixedWorkload() {
  // Sign in once per VU (for authenticated paths)
  ensureAuthenticated();

  const roll = Math.random();

  if (roll < 0.4) {
    // 40%: Health + session (fast path)
    const healthRes = http.get(`${API_URL}/health`, {
      tags: { name: 'GET /health' },
    });
    check(healthRes, {
      'health: status 200': (r) => r.status === 200,
    });
    sleep(0.3);

    const healthReadyRes = http.get(`${API_URL}/health/ready`, {
      tags: { name: 'GET /health/ready' },
    });
    check(healthReadyRes, {
      'health/ready: status 200': (r) => r.status === 200,
    });
  } else if (roll < 0.7) {
    // 30%: List operations (authenticated)
    const endpoints = ['/leads', '/appointments', '/content-styles'];
    const endpoint = endpoints[Math.floor(Math.random() * endpoints.length)];

    const res = authGet(endpoint);
    check(res, {
      [`list ${endpoint}: not 5xx`]: (r) => r.status < 500,
    });
  } else if (roll < 0.9) {
    // 20%: Session validation (authenticated)
    const sessionRes = http.get(`${API_URL}/auth/session`, {
      headers: sessionCookieHeader(),
      tags: { name: 'GET /auth/session' },
    });
    check(sessionRes, {
      'session: status 200': (r) => r.status === 200,
    });

    sleep(0.3);

    // Fetch organization info
    const orgRes = authGet('/organizations/current');
    check(orgRes, {
      'org: not 5xx': (r) => r.status < 500,
    });
  } else {
    // 10%: Liveness check (fast)
    const res = http.get(`${API_URL}/health/live`, {
      tags: { name: 'GET /health/live' },
    });
    check(res, {
      'health/live: status 200': (r) => r.status === 200,
    });
  }

  sleep(1);
}
