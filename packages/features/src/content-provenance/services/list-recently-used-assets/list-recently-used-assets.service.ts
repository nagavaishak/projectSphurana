/**
 * `listRecentlyUsedAssetIds` — which assets has this service's content already
 * used, most recent first?
 *
 * This is the read side of rotation. Selection was deterministic ("newest
 * asset, always"), so a service with two eligible images produced sixteen
 * graphics of the same two — the single most visible content complaint after
 * wrong-footage. Feeding this list back into selection lets it prefer
 * something it has NOT just used.
 *
 * Ordered most-recent-first so callers can treat it as a preference ranking
 * (avoid the head hardest), not just a blocklist. Returns an empty list on any
 * failure: rotation is an improvement, never a gate — if we cannot read the
 * history we should still produce content.
 */

import { contentGenerationProvenance } from '@borradh-workspace/database';
import { trackedResult } from '@borradh-workspace/observability';
import { and, desc, eq, gte, isNotNull } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import {
  type ListRecentlyUsedAssetsInput,
  listRecentlyUsedAssetsSchema,
} from './list-recently-used-assets.schema.js';

const listRecentlyUsedAssetIdsImpl = async (
  db: DbConnection,
  input: ListRecentlyUsedAssetsInput
): Promise<Result<string[]>> => {
  const parsed = listRecentlyUsedAssetsSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId, serviceId, lookbackDays, limit } = parsed.data;

  const since = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000);

  const conditions = [
    eq(contentGenerationProvenance.organizationId, organizationId),
    isNotNull(contentGenerationProvenance.chosenAssetId),
    gte(contentGenerationProvenance.createdAt, since),
  ];
  // Scope to one service when given. Without it, this is "what has this org
  // used lately", which is the right question for cross-service variety.
  if (serviceId) {
    conditions.push(eq(contentGenerationProvenance.serviceId, serviceId));
  }

  const rows = await db
    .select({ assetId: contentGenerationProvenance.chosenAssetId })
    .from(contentGenerationProvenance)
    .where(and(...conditions))
    .orderBy(desc(contentGenerationProvenance.createdAt))
    .limit(limit);

  // De-dupe, preserving recency order — an asset used three times should not
  // appear three times in the preference ranking.
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const row of rows) {
    if (!row.assetId || seen.has(row.assetId)) continue;
    seen.add(row.assetId);
    ordered.push(row.assetId);
  }

  return ok(ordered);
};

export const listRecentlyUsedAssetIds = (
  db: DbConnection,
  input: ListRecentlyUsedAssetsInput
) =>
  trackedResult(
    'contentProvenance.listRecentlyUsedAssetIds',
    () => listRecentlyUsedAssetIdsImpl(db, input),
    {
      properties: {
        organizationId: input.organizationId,
        serviceId: input.serviceId,
      },
      internalErrorsOnly: true,
    }
  );

/**
 * Recency ranking, or an empty list on any failure.
 *
 * Selection callers want a plain array, and must not lose the ability to
 * produce content because the history read failed.
 */
export const listRecentlyUsedAssetIdsSafe = async (
  db: DbConnection,
  input: ListRecentlyUsedAssetsInput
): Promise<string[]> => {
  try {
    const result = await listRecentlyUsedAssetIds(db, input);
    return result.success ? result.data : [];
  } catch {
    return [];
  }
};

export type ListRecentlyUsedAssetsResult = Awaited<
  ReturnType<typeof listRecentlyUsedAssetIds>
>;
