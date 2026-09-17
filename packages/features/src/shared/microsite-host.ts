import { micrositeDomain } from '@borradh-workspace/database';
import { and, eq, inArray } from 'drizzle-orm';
import type { DbConnection } from './core/types.js';

/**
 * Which HOST a tenant's public links are built on.
 *
 * This is the input to every builder in `microsite-links.ts`. It is a VALUE,
 * not a lookup: resolve it once per unit of work and pass it around. That is
 * deliberate — these builders run on email-send and chatbot paths, and a
 * builder that did its own query would turn "email fifty patients" into fifty
 * round trips without anything at the call site looking wrong.
 *
 * `primaryDomain === null` means the path tier (`{WEB_URL}/sites/{slug}/…`),
 * which is where every tenant starts and where a tenant whose domain is not
 * yet live stays.
 */
export interface MicrositeLinkTarget {
  organizationSlug: string;
  /**
   * The tenant's live primary custom domain — lowercased hostname, no scheme.
   * Null unless a `microsite_domain` row is BOTH `isPrimary` AND `active`.
   */
  primaryDomain: string | null;
}

/**
 * The path-tier target — no database access.
 *
 * For call sites that genuinely have no org id (pure functions, fixtures) and
 * for tests that mean to pin the fallback shape.
 */
export const pathTierLinkTarget = (
  organizationSlug: string
): MicrositeLinkTarget => ({ organizationSlug, primaryDomain: null });

/**
 * A domain is only usable when DNS actually points at us and the certificate
 * has been issued — i.e. `status = 'active'`.
 *
 * `pending_dns`, `verifying` and `error` are hosts the tenant has TOLD us
 * about but which may have no DNS record at all; `removed` is a tombstone we
 * keep so the row is never reused. Building a customer-facing link on any of
 * them sends the customer to a host that does not resolve — strictly worse
 * than our own domain, which at least works. So the fallback is total: only
 * `isPrimary` AND `active` counts, and everything else is treated exactly like
 * "this tenant has no custom domain".
 */
const USABLE_STATUS = 'active' as const;

/**
 * The tenant's live primary host, or null.
 *
 * One row at most: `isPrimary` is one-per-site by construction (§2 of the
 * Phase 4 contract flips it, it is not a free-for-all), and `domain` is
 * globally unique.
 */
export const resolvePrimaryMicrositeDomain = async (
  db: DbConnection,
  organizationId: string
): Promise<string | null> => {
  const row = await db.query.micrositeDomain.findFirst({
    columns: { domain: true },
    where: and(
      eq(micrositeDomain.organizationId, organizationId),
      eq(micrositeDomain.isPrimary, true),
      eq(micrositeDomain.status, USABLE_STATUS)
    ),
  });
  return row?.domain ?? null;
};

/**
 * Resolve the link target for ONE org. The single-link case — a confirmation
 * email, a manage link, one chatbot turn.
 */
export const resolveMicrositeLinkTarget = async (
  db: DbConnection,
  org: { id: string; slug: string }
): Promise<MicrositeLinkTarget> => ({
  organizationSlug: org.slug,
  primaryDomain: await resolvePrimaryMicrositeDomain(db, org.id),
});

/**
 * Resolve link targets for MANY orgs in one query — the shape to reach for
 * from any loop.
 *
 * Returns a map keyed by organization id; an org with no live primary domain
 * is still present, carrying the path-tier target, so callers never have to
 * decide what a missing key means.
 */
export const resolveMicrositeLinkTargets = async (
  db: DbConnection,
  orgs: { id: string; slug: string }[]
): Promise<Map<string, MicrositeLinkTarget>> => {
  const targets = new Map<string, MicrositeLinkTarget>(
    orgs.map((org) => [org.id, pathTierLinkTarget(org.slug)])
  );
  if (targets.size === 0) return targets;

  const rows = await db.query.micrositeDomain.findMany({
    columns: { organizationId: true, domain: true },
    where: and(
      inArray(micrositeDomain.organizationId, [...targets.keys()]),
      eq(micrositeDomain.isPrimary, true),
      eq(micrositeDomain.status, USABLE_STATUS)
    ),
  });

  for (const row of rows) {
    const existing = targets.get(row.organizationId);
    if (existing) existing.primaryDomain = row.domain;
  }
  return targets;
};
