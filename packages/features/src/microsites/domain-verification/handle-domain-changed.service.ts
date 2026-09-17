/**
 * Contract §4 — everything a primary-host change owes, in ONE flow.
 *
 * The three effects are not independent chores; they are the three ways a move
 * breaks attribution, and each one fails quietly on its own:
 *
 *   1. The old host keeps answering — the `.borradh.io` subdomain lives
 *      FOREVER and any previously-primary custom host stays `active` with
 *      `isPrimary = false`. Nothing here removes them. That is what lets the
 *      renderer 301 them at the new primary instead of 404ing a link that is
 *      printed on a shopfront. Busting the cache for BOTH hosts is what makes
 *      the redirect start within seconds instead of within the 5-minute TTL.
 *   2. Live ad creative still points at the old host → rewrite
 *      `destination_url` on active ad sets.
 *   3. Meta domain verification + AEM must be redone for the new host.
 *
 * Each step is attempted even if the previous one failed: the ads being
 * un-rewritable is no reason to also skip telling someone about Meta.
 */

import { createLogger, trackedResult } from '@borradh-workspace/observability';
import { type DbConnection, type Result, ok } from '../../shared/index.js';
import type { DomainChangedJobPayload } from './domain-verification.schema.js';
import { bustMicrositeHostCache } from './host-cache.js';
import { requestMetaDomainVerification } from './request-meta-domain-verification.service.js';
import {
  type RewriteAdDestinationsDeps,
  rewriteAdDestinations,
} from './rewrite-ad-destinations.service.js';

const logger = createLogger('MicrositeDomainChanged');

export interface DomainChangedOutput {
  adsRewritten: number;
  adsFailed: number;
  metaNotified: number;
}

const handleDomainChangedImpl = async (
  db: DbConnection,
  input: DomainChangedJobPayload,
  deps: RewriteAdDestinationsDeps
): Promise<Result<DomainChangedOutput>> => {
  const { organizationId, previousHost, newHost } = input;

  // 1. Both hosts change meaning at once: the new one starts resolving, the
  //    old one starts redirecting.
  await bustMicrositeHostCache([previousHost, newHost]);

  // 2. Ads.
  const ads = await rewriteAdDestinations(
    db,
    { organizationId, previousHost, newHost },
    deps
  );

  // 3. Meta domain verification / AEM.
  const meta = await requestMetaDomainVerification(db, {
    organizationId,
    host: newHost,
  });

  const out: DomainChangedOutput = {
    adsRewritten: ads.success ? ads.data.rewritten : 0,
    adsFailed: ads.success ? ads.data.failed : 0,
    metaNotified: meta.success ? meta.data.notified : 0,
  };

  logger.info('Handled microsite domain_changed', {
    micrositeId: input.micrositeId,
    previousHost,
    newHost,
    ...out,
  });

  return ok(out);
};

export const handleDomainChanged = (
  db: DbConnection,
  input: DomainChangedJobPayload,
  deps: RewriteAdDestinationsDeps = {}
) =>
  trackedResult(
    'microsites.handleDomainChanged',
    () => handleDomainChangedImpl(db, input, deps),
    { properties: { organizationId: input.organizationId } }
  );
