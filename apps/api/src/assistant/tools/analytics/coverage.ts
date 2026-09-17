import { defineCoverage } from '../coverage.types.js';

/**
 * ANALYTICS — 1 endpoint, 0 tools.
 *
 * The name is misleading and worth flagging so nobody grades it by the label:
 * this area contains no reporting. There is no "read my numbers" route here.
 * The single endpoint is a REPLAY JOB — it walks historical rows and re-emits
 * them into PostHog to repair a gap left by an instrumentation outage.
 *
 * The analytics an owner actually asks about are already Claire's: ad and
 * campaign performance through the meta-ads insight tools, leads through
 * leads_getLeadStats, offers through offers_getOfferPerformance.
 */
export const analyticsCoverage = defineCoverage('analytics', {
  'POST /analytics/backfill': {
    notExposed:
      'Replays historical rows into PostHog to repair a period when instrumentation was dark. It is a one-off repair job run by an engineer who knows the exact window; re-running it over a period already ingested double-counts events and corrupts the very numbers it exists to fix.',
  },
});
