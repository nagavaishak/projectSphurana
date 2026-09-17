import { check } from 'k6';

/**
 * Common response validators for load tests
 */

export function checkStatus200(res, label = 'response') {
  return check(res, {
    [`${label}: status 200`]: (r) => r.status === 200,
    [`${label}: response time < 2s`]: (r) => r.timings.duration < 2000,
  });
}

export function checkStatus2xx(res, label = 'response') {
  return check(res, {
    [`${label}: status 2xx`]: (r) => r.status >= 200 && r.status < 300,
    [`${label}: response time < 2s`]: (r) => r.timings.duration < 2000,
  });
}

export function checkJsonResponse(res, label = 'response') {
  return check(res, {
    [`${label}: status 200`]: (r) => r.status === 200,
    [`${label}: is JSON`]: (r) =>
      r.headers['Content-Type']?.includes('application/json'),
    [`${label}: has body`]: (r) => r.body && r.body.length > 0,
  });
}

export function checkListResponse(res, label = 'list') {
  return check(res, {
    [`${label}: status 200`]: (r) => r.status === 200,
    [`${label}: is array or has items`]: (r) => {
      try {
        const body = JSON.parse(r.body);
        return Array.isArray(body) || Array.isArray(body.items);
      } catch {
        return false;
      }
    },
  });
}
