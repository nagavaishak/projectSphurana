/**
 * Contract §4 — rewrite `destination_url` on live ads when a site's primary
 * host changes.
 *
 * Live creative keeps pointing at the old host after a move. The old host does
 * still answer (we 301 it, and the `.borradh.io` subdomain lives forever), so
 * nothing *breaks* — which is exactly the problem: every click takes an extra
 * hop, the pixel fires on a host Meta has not verified, and nobody notices for
 * a month. So the rewrite is part of the domain_changed flow, not a runbook
 * step.
 *
 * `updateAd` is the existing meta-ads service: it writes our row AND pushes the
 * creative to Meta, so this file does not need to know anything about the Graph
 * API.
 */

import { metaAd } from '@borradh-workspace/database';
import { createLogger, trackedResult } from '@borradh-workspace/observability';
import { and, eq, inArray, isNotNull } from 'drizzle-orm';
// Through the meta-ads context's PUBLIC barrel, not a deep path into its
// internals — the cross-context gate enforces this.
import { updateAd } from '../../meta-ads/index.js';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../shared/index.js';

const logger = createLogger('MicrositeAdDestinationRewrite');

/**
 * Statuses worth rewriting. A `draft` ad has not been pushed to Meta and will
 * pick the new host up when it launches; `rejected` and `error` ads cannot be
 * updated at all (`updateAd` refuses `rejected` outright).
 */
const REWRITABLE_STATUSES = [
  'active',
  'paused',
  'pending',
  'launching',
] as const;

export interface RewriteAdDestinationsInput {
  organizationId: string;
  /** The host the ads currently point at. */
  previousHost: string;
  /** The host they should point at. */
  newHost: string;
}

export interface RewriteAdDestinationsDeps {
  /**
   * Injected so a test can pin the rewrite without mocking the meta-ads module
   * — under `isolate: false` a `vi.mock` of an internal module persists on the
   * shared worker graph and poisons meta-ads' own tests.
   */
  updateAd?: typeof updateAd;
}

export interface RewriteAdDestinationsOutput {
  scanned: number;
  rewritten: number;
  failed: number;
}

/**
 * Swap the host, keep everything else.
 *
 * Path, query and fragment carry the UTM history and the booking deep-link —
 * rebuilding the URL from the new host alone would silently drop both.
 * Returns null when the URL does not belong to the old host, so an ad pointing
 * somewhere else entirely is left alone.
 */
export const swapUrlHost = (
  rawUrl: string,
  previousHost: string,
  newHost: string
): string | null => {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }

  const current = url.hostname.toLowerCase();
  const from = previousHost.toLowerCase();
  const matches = current === from || current === `www.${from}`;
  if (!matches) return null;

  url.hostname = newHost.toLowerCase();
  // A custom domain is always served over TLS; an ad still carrying http://
  // would eat a redirect on every click.
  url.protocol = 'https:';
  const next = url.toString();
  return next === rawUrl ? null : next;
};

const rewriteAdDestinationsImpl = async (
  db: DbConnection,
  input: RewriteAdDestinationsInput,
  deps: RewriteAdDestinationsDeps
): Promise<Result<RewriteAdDestinationsOutput>> => {
  const update = deps.updateAd ?? updateAd;
  const { organizationId, previousHost, newHost } = input;
  if (!organizationId || !previousHost || !newHost) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid rewrite input')
    );
  }

  const ads = await db
    .select({
      id: metaAd.id,
      destinationUrl: metaAd.destinationUrl,
    })
    .from(metaAd)
    .where(
      and(
        eq(metaAd.organizationId, organizationId),
        isNotNull(metaAd.destinationUrl),
        inArray(metaAd.status, [...REWRITABLE_STATUSES])
      )
    );

  let rewritten = 0;
  let failed = 0;

  for (const ad of ads) {
    const next = swapUrlHost(ad.destinationUrl ?? '', previousHost, newHost);
    if (!next) continue;

    // Per-ad, not all-or-nothing: one ad Meta refuses must not strand the rest
    // on the old host.
    const result = await update(db, {
      adId: ad.id,
      organizationId,
      destinationUrl: next,
      targetingOverride: undefined,
    });

    if (result.success) {
      rewritten += 1;
    } else {
      failed += 1;
      logger.error('Failed to rewrite ad destination after domain change', {
        adId: ad.id,
        organizationId,
        code: result.error.code,
      });
    }
  }

  logger.info('Rewrote ad destinations for domain change', {
    organizationId,
    scanned: ads.length,
    rewritten,
    failed,
  });

  return ok({ scanned: ads.length, rewritten, failed });
};

export const rewriteAdDestinations = (
  db: DbConnection,
  input: RewriteAdDestinationsInput,
  deps: RewriteAdDestinationsDeps = {}
) =>
  trackedResult(
    'microsites.rewriteAdDestinations',
    () => rewriteAdDestinationsImpl(db, input, deps),
    { properties: { organizationId: input.organizationId } }
  );
