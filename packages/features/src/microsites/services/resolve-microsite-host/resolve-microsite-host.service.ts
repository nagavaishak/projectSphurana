/**
 * Host → microsite. THE hot path: this runs on every public request to every
 * tenant site (plan §9), in front of a 5-minute Redis cache that this service
 * populates.
 *
 * Three tiers, in priority order:
 *
 *   1. CUSTOM     `salonname.com`        → `microsite_domain`, status `active`
 *   2. WILDCARD   `{slug}.borradh.io`    → `microsite.slug`
 *   3. PATH       `borradh.io/sites/{slug}` → `microsite.slug`
 *
 * Custom wins over wildcard because a tenant who has pointed their own domain
 * at us has made a choice, and because a custom domain could in principle be a
 * subdomain of our own apex.
 *
 * TWO THINGS THIS DELIBERATELY DOES NOT DO:
 *
 *   - It is NOT authorized, and takes no `organizationId`. Every other service
 *     in this folder enforces the org boundary (plan §12); this one cannot,
 *     because it runs before there is a caller. It is therefore restricted to
 *     returning IDENTIFIERS — never the document, never the theme, never a
 *     domain's verification payload. Keep it that way: this is the one function
 *     here that an anonymous internet client can reach.
 *   - It never redirects. An unknown host is NOT_FOUND. A redirect to the
 *     marketing apex on an unknown host is how you get a loop when the apex
 *     itself is misrouted, and plan §9 calls that out by name.
 *
 * Only a status-`active` domain resolves. `pending_dns`, `verifying`, `error`
 * and the `removed` tombstone must all miss — serving a tenant's site on a
 * half-verified hostname is how a domain gets served for an org that no longer
 * owns it.
 */

import { microsite, micrositeDomain } from '@borradh-workspace/database';
import { trackedResult } from '@borradh-workspace/observability';
import { and, eq } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import { RESERVED_MICROSITE_SLUGS } from '../create-microsite/index.js';
import {
  micrositeBaseDomains,
  micrositeHostCacheKey,
  normalizeHost,
  readMicrositeHostCache,
  writeMicrositeHostCache,
} from '../microsite-host-cache/index.js';
import {
  type ResolveMicrositeHostInput,
  resolveMicrositeHostSchema,
} from './resolve-microsite-host.schema.js';

// Re-exported so the resolver stays the one import a caller needs. The
// definition lives in the cache module because the BUST side needs it too, and
// importing the resolver from there would be a cycle.
export { normalizeHost };

/** Which tier matched. Useful in logs and for deciding the cache TTL. */
export type MicrositeHostTier = 'custom' | 'wildcard' | 'path';

/**
 * Identifiers only — see the file header. This is not a document read, and
 * widening it is a security change, not a convenience one.
 */
export interface ResolvedMicrositeHost {
  micrositeId: string;
  organizationId: string;
  slug: string;
  status: 'draft' | 'published';
  tier: MicrositeHostTier;
}

/** `/sites/acme/about` → `acme`. */
const slugFromPath = (path: string | undefined): string | null => {
  if (!path) return null;
  const match = /^\/sites\/([a-z0-9][a-z0-9-]*)(?:\/|$)/.exec(
    path.toLowerCase()
  );
  return match ? match[1] : null;
};

const bySlug = async (
  db: DbConnection,
  slug: string,
  tier: MicrositeHostTier
): Promise<ResolvedMicrositeHost | null> => {
  // A reserved label is never a tenant. Checked before the query so a request
  // for `www.borradh.io` cannot become a lookup for a site called "www".
  if (RESERVED_MICROSITE_SLUGS.has(slug)) return null;

  const row = await db.query.microsite.findFirst({
    where: eq(microsite.slug, slug),
    columns: { id: true, organizationId: true, slug: true, status: true },
  });
  if (!row) return null;

  return {
    micrositeId: row.id,
    organizationId: row.organizationId,
    slug: row.slug,
    status: row.status,
    tier,
  };
};

/**
 * The three tiers, straight off the database. `null` is "no such host" — the
 * caller turns that into NOT_FOUND *and* into a cached negative lookup, so this
 * returns a plain value rather than a Result.
 */
const resolveFromDatabase = async (
  db: DbConnection,
  {
    host,
    isOwnApex,
    wildcardApex,
    pathSlug,
  }: {
    host: string;
    isOwnApex: boolean;
    wildcardApex: string | undefined;
    pathSlug: string | null;
  }
): Promise<ResolvedMicrositeHost | null> => {
  // ── Tier 1: custom domain ────────────────────────────────────────
  //
  // Only for hosts that are NOT ours: a tenant cannot register a
  // `*.borradh.io` name as a "custom" domain and jump the wildcard tier.
  if (!isOwnApex && !wildcardApex) {
    // `www.salon.com` and `salon.com` are provisioned as a pair (plan §9), but
    // only one of them is guaranteed to be the row we hold, so try the apex
    // form as well before giving up.
    const candidates =
      host.startsWith('www.') && host.length > 4
        ? [host, host.slice(4)]
        : [host];

    for (const candidate of candidates) {
      const domain = await db.query.micrositeDomain.findFirst({
        where: and(
          eq(micrositeDomain.domain, candidate),
          eq(micrositeDomain.status, 'active')
        ),
        columns: { micrositeId: true, organizationId: true },
        with: {
          microsite: {
            columns: {
              id: true,
              organizationId: true,
              slug: true,
              status: true,
            },
          },
        },
      });

      if (domain?.microsite) {
        return {
          micrositeId: domain.microsite.id,
          organizationId: domain.microsite.organizationId,
          slug: domain.microsite.slug,
          status: domain.microsite.status,
          tier: 'custom',
        };
      }
    }

    // No custom-domain row — fall through to the PATH tier rather than giving
    // up. An unrecognised host carrying `/sites/{slug}` is the path tier by
    // definition: that is the whole point of a fallback that needs no DNS.
    //
    // Returning null here made the "tier that always works" work on exactly
    // one host — the production apex. Every Vercel preview host and every
    // localhost stack answered "Unknown host" for a published site, so
    // microsites could not be viewed anywhere they are actually developed.
    //
    // Ordering is deliberate: the host tiers are still tried FIRST, so a live
    // custom domain keeps resolving to ITS tenant and this cannot be used to
    // serve one tenant's site from another tenant's domain by URL alone.
    return pathSlug ? await bySlug(db, pathSlug, 'path') : null;
  }

  // ── Tier 2: `{slug}.borradh.io` ──────────────────────────────────
  if (wildcardApex) {
    const label = host.slice(0, host.length - wildcardApex.length - 1);
    // Only a SINGLE label is a microsite. `a.b.borradh.io` is not a tenant
    // site, and treating it as one would resolve `www.acme.borradh.io`.
    if (label && !label.includes('.')) {
      return await bySlug(db, label, 'wildcard');
    }
    return null;
  }

  // ── Tier 3: `borradh.io/sites/{slug}` ────────────────────────────
  //
  // The tier that ALWAYS works: it needs no DNS and no certificate, so it is
  // the fallback a tenant can always be given while a domain is still verifying.
  return pathSlug ? await bySlug(db, pathSlug, 'path') : null;
};

/**
 * Validate, classify the host, then answer from Redis if we can.
 *
 * ONE cache read on the common path, and nothing else: the tier classification
 * is pure string work, and a hit returns before any database connection is
 * touched. A miss is cached too (contract §3) — scanner traffic from the open
 * internet is the bulk of the requests that reach here, and each uncached one
 * is a query.
 */
const resolveMicrositeHostImpl = async (
  db: DbConnection,
  input: ResolveMicrositeHostInput
): Promise<Result<ResolvedMicrositeHost>> => {
  const parsed = resolveMicrositeHostSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid host', {
        issues: parsed.error.issues,
      })
    );
  }

  const host = normalizeHost(parsed.data.host);
  if (!host) {
    return err(new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid host'));
  }

  const apexes = micrositeBaseDomains();
  const isOwnApex = apexes.includes(host);
  const wildcardApex = apexes.find((apex) => host.endsWith(`.${apex}`));
  // Parsed on EVERY host, not just our apex. `/sites/{slug}` names the tenant
  // by itself — that is what makes the path tier the fallback that needs no
  // DNS — and gating the parse on recognising the host is what made it
  // unreachable on Vercel previews and localhost.
  const pathSlug = slugFromPath(parsed.data.path);

  // Our own apex with no `/sites/{slug}` is the marketing site, not a tenant.
  // There is nothing to key a cache entry on (every marketing path would share
  // one key) and nothing to query, so answer immediately.
  if (isOwnApex && !pathSlug) {
    return err(new FeatureError(ErrorCodes.NOT_FOUND, 'Unknown host'));
  }

  const cacheKey = micrositeHostCacheKey(host, pathSlug);

  const cached = await readMicrositeHostCache<ResolvedMicrositeHost>(cacheKey);
  if (cached.kind === 'hit') return ok(cached.value);
  if (cached.kind === 'miss') {
    return err(new FeatureError(ErrorCodes.NOT_FOUND, 'Unknown host'));
  }

  const resolved = await resolveFromDatabase(db, {
    host,
    isOwnApex,
    wildcardApex,
    pathSlug,
  });

  // `null` writes the NEGATIVE entry. Both writes are fire-and-forget as far as
  // correctness goes — see the cache module: a Redis failure degrades to an
  // uncached resolve, never to a failed request.
  await writeMicrositeHostCache(cacheKey, resolved);

  return resolved
    ? ok(resolved)
    : err(new FeatureError(ErrorCodes.NOT_FOUND, 'Unknown host'));
};

export const resolveMicrositeHost = (
  db: DbConnection,
  input: ResolveMicrositeHostInput
) =>
  trackedResult(
    'microsites.resolveMicrositeHost',
    () => resolveMicrositeHostImpl(db, input),
    {
      properties: { host: input.host },
      // NOT_FOUND is the ordinary answer for any bot probing our apex — logging
      // it would be a self-inflicted flood on the hottest path in the feature.
      internalErrorsOnly: true,
      trackSuccess: false,
    }
  );

export type ResolveMicrositeHostResult = Awaited<
  ReturnType<typeof resolveMicrositeHost>
>;
