/**
 * The publish-side trigger: make sure every live custom host of this microsite
 * is claimed and carries a verification tag.
 *
 * WHY PUBLISH IS A TRIGGER AT ALL, given activation already is: publish is the
 * moment the page's HTML is regenerated, and the meta tag lives in that HTML.
 * A domain activated while the site was still a draft, an org that connected
 * Meta *after* its domain went live, a claim that failed transiently three
 * weeks ago — all of them are silently repaired by the next publish, because
 * this runs then. It is cheap: for an already-verified domain it is one GET.
 *
 * It never throws and never returns an error. Publish must not be able to fail
 * because Meta is down.
 */

import { micrositeDomain } from '@borradh-workspace/database';
import { createLogger } from '@borradh-workspace/observability';
import { and, eq } from 'drizzle-orm';
import type { DbConnection } from '../../../shared/index.js';
import { ensureMetaDomainVerification } from './ensure-meta-domain-verification.service.js';
import type { MetaVerificationOutcome } from './meta-verification.types.js';

const logger = createLogger('MicrositeMetaDomainVerification');

export interface SyncMicrositeMetaDomainsOutput {
  checked: number;
  outcomes: MetaVerificationOutcome[];
}

export const syncMicrositeMetaDomains = async (
  db: DbConnection,
  input: { micrositeId: string; organizationId: string }
): Promise<SyncMicrositeMetaDomainsOutput> => {
  const out: SyncMicrositeMetaDomainsOutput = { checked: 0, outcomes: [] };

  try {
    const rows = await db.query.micrositeDomain.findMany({
      where: and(
        eq(micrositeDomain.micrositeId, input.micrositeId),
        eq(micrositeDomain.organizationId, input.organizationId),
        eq(micrositeDomain.status, 'active')
      ),
      columns: { domain: true },
    });

    for (const row of rows ?? []) {
      const result = await ensureMetaDomainVerification(db, {
        organizationId: input.organizationId,
        host: row.domain,
      });
      out.checked += 1;
      out.outcomes.push(
        result.success ? result.data.outcome : 'transient_failure'
      );
    }
  } catch (error) {
    // Deliberately swallowed: the caller is a publish, and a verification
    // sweep is not allowed to fail one. The per-domain service already logged
    // anything actionable.
    logger.warn('Meta domain sync skipped', {
      micrositeId: input.micrositeId,
      error: error instanceof Error ? error.message : 'unknown',
    });
  }

  return out;
};
