import {
  type ContentItemSource,
  contentAttempt,
} from '@borradh-workspace/database';
import { and, eq } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import { insertSlotWithFirstAttempt } from '../insert-slot/index.js';

export interface EnsureItemForAssetInput {
  organizationId: string;
  /** Exactly one. */
  graphicId?: string | null;
  videoId?: string | null;
  source: ContentItemSource;
  caption?: string | null;
}

export interface EnsureItemForAssetOutput {
  itemId: string;
  /**
   * True when this call created the item. Useful to the caller only as a
   * signal that the asset predates item tracking — nothing branches on it.
   */
  adopted: boolean;
}

/**
 * Find the item that owns an asset, creating one if the asset predates items.
 *
 * ADOPTION, and why there is no backfill migration.
 *
 * Every graphic and video created before this shipped has no item — no lineage,
 * no instruction, no undo. Backfilling them would mean minting hundreds of
 * thousands of item rows for content nobody will ever edit again, and guessing
 * a `source` for each. Instead an asset joins the model the first time someone
 * edits it: attempt 0 IS the existing asset, and the edit becomes attempt 1. A
 * graphic that is never edited never needs a row.
 *
 * The consequence to be honest about: `attempt 0` for an adopted asset is a
 * reconstruction, not a record. It says "this is what was there when we started
 * tracking", not "this is what was generated and why" — `regenerationReason` is
 * null on it, correctly, because nobody asked for it.
 *
 * Lookup is by asset id across ALL attempts, not just current ones: an asset
 * that has already been superseded still belongs to its item, and editing from
 * an older cut should extend that item rather than fork a second one.
 */
export const ensureItemForAsset = async (
  db: DbConnection,
  input: EnsureItemForAssetInput
): Promise<Result<EnsureItemForAssetOutput>> => {
  const { organizationId, graphicId, videoId, source, caption } = input;

  if (!graphicId && !videoId) {
    return err(
      new FeatureError(
        ErrorCodes.VALIDATION_ERROR,
        'An item is opened for a video or a graphic'
      )
    );
  }
  if (graphicId && videoId) {
    return err(
      new FeatureError(
        ErrorCodes.VALIDATION_ERROR,
        'An item is opened for a video or a graphic, not both'
      )
    );
  }

  const assetPredicate = graphicId
    ? eq(contentAttempt.graphicId, graphicId)
    : eq(contentAttempt.videoId, videoId as string);

  const [existing] = await db
    .select({ slotId: contentAttempt.slotId })
    .from(contentAttempt)
    .where(
      and(assetPredicate, eq(contentAttempt.organizationId, organizationId))
    )
    .limit(1);

  if (existing) {
    return ok({ itemId: existing.slotId, adopted: false });
  }

  try {
    const { slotId } = await insertSlotWithFirstAttempt(db, {
      organizationId,
      // Standalone by construction. An asset that belongs to a batch already
      // has an item — the planner opened one — so reaching here means it does
      // not, and inventing a batch link would be a lie.
      batchId: null,
      source,
      kind: graphicId ? 'graphic' : 'video',
      position: null,
      graphicId: graphicId ?? null,
      videoId: videoId ?? null,
      caption: caption ?? null,
    });
    return ok({ itemId: slotId, adopted: true });
  } catch (error) {
    // Two edits on the same untracked asset can race to adopt it. There is no
    // unique constraint to lean on here (an asset id is not unique across
    // attempts by design), so re-read: whoever won owns the item, and both
    // callers should end up pointing at it rather than one of them failing.
    const [raced] = await db
      .select({ slotId: contentAttempt.slotId })
      .from(contentAttempt)
      .where(
        and(assetPredicate, eq(contentAttempt.organizationId, organizationId))
      )
      .limit(1);
    if (raced) return ok({ itemId: raced.slotId, adopted: false });

    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to open a content item for this asset',
        { graphicId, videoId },
        error instanceof Error ? error : undefined
      )
    );
  }
};
