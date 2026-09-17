import { defineCoverage } from '../coverage.types.js';

/**
 * HEALTH — 4 endpoints, 0 tools. Probes, whose callers are a load balancer,
 * an uptime monitor and a container orchestrator.
 *
 * The tempting mistake is to read `/health/ready` as a diagnostic Claire could
 * use — it does check the database and Redis, after all. It is not one, for a
 * reason that generalises: a probe answers about THE INSTANCE THAT SERVED IT,
 * and behind a load balancer that is a different instance each time. A green
 * answer from one healthy container says nothing about the one that just
 * failed the owner's request, which is precisely the case where somebody would
 * be tempted to ask.
 *
 * More to the point, if the API were actually unhealthy, Claire's own request
 * would not have arrived. She cannot report an outage she is unable to survive,
 * so a tool here would only ever return "fine" — the single least useful
 * possible answer, and an actively misleading one.
 */
export const healthCoverage = defineCoverage('health', {
  'GET /health': {
    notExposed:
      'The uptime monitor’s 30-second check. It answers a prober, and Claire could never observe a failing response because a failing API would not be running the turn that asked.',
  },
  'GET /health/live': {
    notExposed:
      'Liveness probe for the container orchestrator — "is this process alive", which is answered by the fact that it replied at all. Tautological to any caller already inside a request.',
  },
  'GET /health/identity': {
    notExposed:
      'Says WHICH local stack answered — database name and process cwd — so a developer with ~90 worktrees can prove the api on a port is the one their branch started. Disabled outside development entirely, and about the machine rather than the business, so there is nothing here for Claire to tell an owner.',
  },
  'GET /health/ready': {
    notExposed:
      'Deep readiness check including database and Redis latency, scoped to the single instance that served it. Behind a load balancer that is a different container each call, so a green answer cannot clear the one that just failed a customer.',
  },
});
