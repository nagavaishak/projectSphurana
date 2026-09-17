/**
 * The renderer's read: "what, if anything, do I put in the head for this host?"
 *
 * Deliberately its OWN narrow service rather than a field on
 * `resolveMicrositeHost`. That resolver runs unauthenticated on every public
 * request and its file header is explicit that it returns identifiers only and
 * never a domain's verification payload — widening it is a security change.
 * This one is a single-column read, keyed by host, returning a value that is
 * public by design (the meta tag is served to the world).
 *
 * WHERE THE RENDERER USES IT: in the microsite page's <head> — for the
 * current implementation, `apps/marketing-astro/src/layouts/MicrositeShell.astro`
 * — emit nothing when this returns null, and otherwise exactly:
 *
 *     <meta name="facebook-domain-verify" content={token} />
 *
 * It must be present on the CUSTOM domain's HTML, since that is the host Meta
 * crawls. Serving it on the `{slug}.borradh.io` fallback does nothing (that
 * apex is ours, not the tenant's) — which is why lookup is by host and returns
 * null there.
 */

import { micrositeDomain } from '@borradh-workspace/database';
import { eq } from 'drizzle-orm';
import type { DbConnection } from '../../../shared/index.js';
import {
  META_DOMAIN_VERIFY_TAG_NAME,
  META_VERIFICATION_KEY,
  type MetaDomainVerificationState,
} from './meta-verification.types.js';

export { META_DOMAIN_VERIFY_TAG_NAME };

/**
 * The `content` value for the meta tag, or null when there is nothing to
 * serve. Never throws: a verification lookup must not be able to 500 a
 * tenant's home page.
 */
export const getMetaVerificationToken = async (
  db: DbConnection,
  input: { host: string }
): Promise<string | null> => {
  const host = input.host.trim().toLowerCase().replace(/\.$/, '');
  if (!host) return null;

  try {
    const row = await db.query.micrositeDomain.findFirst({
      where: eq(micrositeDomain.domain, host),
      columns: { verification: true, status: true },
    });
    if (!row || row.status === 'removed') return null;

    const verification = row.verification as Record<string, unknown> | null;
    const state = verification?.[META_VERIFICATION_KEY] as
      | MetaDomainVerificationState
      | undefined;

    const token = state?.token;
    return typeof token === 'string' && token.length > 0 ? token : null;
  } catch {
    return null;
  }
};
