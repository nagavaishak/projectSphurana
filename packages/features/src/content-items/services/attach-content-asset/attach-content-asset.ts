import { contentAttempt, withOrgScope } from '@borradh-workspace/database';
import { trackedResult } from '@borradh-workspace/observability';
import { eq } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import { loadSlotForOrg } from '../load-slot/index.js';
import { recordAttempt } from '../record-attempt/index.js';

export interface AttachContentAssetInput {
  itemId: string;
  organizationId: string;
  /** Exactly one, matching the item's kind. */
  videoId?: string | null;
  graphicId?: string | null;
  reason?: string | null;
}

export interface AttachContentAssetOutput {
  attemptNumber: number;
  /** True when this FILLED the proposal rather than appending a new cut. */
  filledProposal: boolean;
}

/**
 * Put a newly made asset on its item.
 *
 * Two cases, and the difference matters for the history:
 *
 *  - The item is a PROPOSAL — attempt 0 exists with a null asset, because the
 *    card was shown before the content was made. Fill it. Appending instead
 *    would leave an empty attempt 0 forever and report the first version of the
 *    content as its second.
 *  - The item already has content. Append, exactly like a re-roll.
 *
 * Filling is what makes the card's "have I been accepted?" question answerable:
 * a null asset means no, a filled one means yes, and it survives a remount
 * because it is a row rather than a hook.
 */
const attachContentAssetImpl = async (
  db: DbConnection,
  input: AttachContentAssetInput
): Promise<Result<AttachContentAssetOutput>> => {
  const { itemId, organizationId, videoId, graphicId, reason } = input;

  if (!videoId && !graphicId) {
    return err(
      new FeatureError(
        ErrorCodes.VALIDATION_ERROR,
        'An asset is a video or a graphic'
      )
    );
  }

  const loaded = await loadSlotForOrg(db, { itemId, organizationId });
  if (!loaded.success) return err(loaded.error);
  const { attempt } = loaded.data;

  const isProposal = !attempt.videoId && !attempt.graphicId;

  if (isProposal) {
    try {
      await withOrgScope(
        (tx) =>
          tx
            .update(contentAttempt)
            .set({
              videoId: videoId ?? null,
              graphicId: graphicId ?? null,
              ...(reason ? { regenerationReason: reason } : {}),
            })
            .where(eq(contentAttempt.id, attempt.id)),
        { db }
      );
    } catch (error) {
      return err(
        new FeatureError(
          ErrorCodes.INTERNAL_ERROR,
          'Failed to attach the asset to this item',
          { itemId },
          error instanceof Error ? error : undefined
        )
      );
    }
    return ok({ attemptNumber: attempt.attemptNumber, filledProposal: true });
  }

  const appended = await recordAttempt(db, {
    itemId,
    organizationId,
    videoId: videoId ?? null,
    graphicId: graphicId ?? null,
    reason: reason ?? null,
  });
  if (!appended.success) return err(appended.error);

  return ok({
    attemptNumber: appended.data.attemptNumber,
    filledProposal: false,
  });
};

export const attachContentAsset = (
  db: DbConnection,
  input: AttachContentAssetInput
) =>
  trackedResult(
    'contentItems.attachContentAsset',
    () => attachContentAssetImpl(db, input),
    {
      properties: {
        itemId: input.itemId,
        organizationId: input.organizationId,
      },
    }
  );
