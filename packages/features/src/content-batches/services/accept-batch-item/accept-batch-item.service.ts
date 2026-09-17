import {
  type ContentItem,
  contentAttempt,
  contentItem,
  withOrgScope,
} from '@borradh-workspace/database';
import { trackedResult } from '@borradh-workspace/observability';
import { and, eq } from 'drizzle-orm';
import { getGraphic } from '../../../graphics/services/get-graphic/index.js';
import { collectGraphicSlideUrls } from '../../../graphics/utils/carousel-slides.js';
import {
  type DbConnection,
  type ErrorCode,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import {
  type CreateSocialPostInput,
  createSocialPost,
} from '../../../social-posts/services/create-social-post/index.js';
import { getVideo } from '../../../videos/services/get-video/index.js';
import { loadPendingSlotForOrg } from '../_shared/index.js';
import { settleBatchStatus } from '../settle-batch-status/index.js';
import {
  type AcceptBatchItemInput,
  acceptBatchItemSchema,
} from './accept-batch-item.schema.js';

/**
 * Accept a batch item AND schedule it to socials.
 *
 * Accepting is the user's "ship it" action in the review dialog, so it does
 * the full job: resolve the item's media (the rendered video, or every slide
 * of the graphic — one image for a single graphic, all slides for a carousel),
 * then create a social post for the chosen pages with the (possibly edited)
 * caption + schedule, and link it back via `scheduledSocialPostId`.
 *
 * Overrides (`caption` / `scheduledAt` / `targetPageIds`) come from the review
 * dialog; when absent we fall back to the planner-seeded values on the item.
 * A `scheduledAt` produces a `scheduled` post; its absence produces a `draft`.
 *
 * Failure policy: if `createSocialPost` fails we do NOT flip the item to
 * accepted — the user can retry without losing the slot.
 *
 * Returns INVALID_STATE if the item is already terminal
 * (accepted / regenerated / rejected), if its asset isn't ready yet, or if it
 * has no target pages to post to.
 */
const acceptBatchItemImpl = async (
  db: DbConnection,
  input: AcceptBatchItemInput
): Promise<Result<ContentItem>> => {
  const parsed = acceptBatchItemSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { itemId, organizationId, createdById } = parsed.data;

  const loaded = await loadPendingSlotForOrg(db, { itemId, organizationId });
  if (!loaded.success) return err(loaded.error);
  // Scheduling and the decision come off the SLOT; the words and the asset come
  // off the cut the owner is actually looking at.
  const { slot: item, attempt } = loaded.data;

  // Resolve scheduling fields: overrides win, else the planner-seeded values.
  const targetPageIds = parsed.data.targetPageIds ?? item.targetPageIds ?? [];
  const scheduledAt =
    parsed.data.scheduledAt !== undefined
      ? parsed.data.scheduledAt
      : (item.scheduledAt ?? null);
  const status: 'draft' | 'scheduled' = scheduledAt ? 'scheduled' : 'draft';

  // PAGES ARE A SCHEDULING CONCERN, not an acceptance one.
  //
  // Saving a post means keeping it: the asset stays in the library and the item
  // is decided. It commits to publishing nowhere, so which page it would go to
  // is a question about a decision the owner has not made — and demanding an
  // answer refused every Save with "pick at least one page". Scheduling is
  // where a page is genuinely required, because that IS the commitment.
  const isScheduling = scheduledAt !== null;
  if (isScheduling && targetPageIds.length === 0) {
    return err(
      new FeatureError(
        ErrorCodes.INVALID_STATE,
        'Item has no target pages to post to — pick at least one page'
      )
    );
  }

  const caption = parsed.data.caption ?? attempt.caption ?? undefined;

  // Resolve the item's media into the social-post media fields.
  let media: Pick<
    CreateSocialPostInput,
    | 'mediaType'
    | 'mediaUrl'
    | 'mediaUrls'
    | 'thumbnailUrl'
    | 'videoId'
    | 'graphicId'
  >;
  let title: string;

  if (item.kind === 'video') {
    if (!attempt.videoId) {
      return err(
        new FeatureError(ErrorCodes.INVALID_STATE, 'Video item has no video')
      );
    }
    const videoResult = await getVideo(db, { id: attempt.videoId });
    if (!videoResult.success) {
      return err(
        new FeatureError(
          videoResult.error.code as ErrorCode,
          videoResult.error.message
        )
      );
    }
    const video = videoResult.data;
    if (!video || video.status !== 'ready' || !video.blobUrl) {
      return err(
        new FeatureError(
          ErrorCodes.INVALID_STATE,
          'Video is not ready to schedule yet'
        )
      );
    }
    title = video.title;
    media = {
      mediaType: 'video',
      mediaUrl: video.blobUrl,
      thumbnailUrl: video.thumbnailUrl ?? undefined,
      videoId: video.id,
    };
  } else {
    if (!attempt.graphicId) {
      return err(
        new FeatureError(
          ErrorCodes.INVALID_STATE,
          'Graphic item has no graphic'
        )
      );
    }
    const graphicResult = await getGraphic(db, {
      id: attempt.graphicId,
      organizationId,
    });
    if (!graphicResult.success) {
      return err(
        new FeatureError(
          graphicResult.error.code as ErrorCode,
          graphicResult.error.message
        )
      );
    }
    const graphic = graphicResult.data;
    const outputs = Array.isArray(graphic.outputs) ? graphic.outputs : [];
    // Collect every successfully-rendered slide in carousel order. A single
    // graphic yields one URL; a carousel yields one per slide. We dedupe to a
    // single output per slide (a graphic may render the same slide for several
    // aspect ratios) and order by slideOrder so the carousel posts in sequence.
    const slideUrls = collectGraphicSlideUrls(outputs);
    const firstUrl = slideUrls[0];
    if (graphic.status !== 'ready' || !firstUrl) {
      return err(
        new FeatureError(
          ErrorCodes.INVALID_STATE,
          'Graphic is not ready to schedule yet'
        )
      );
    }
    title = graphic.title ?? 'Scheduled graphic';
    media = {
      mediaType: 'image',
      mediaUrl: firstUrl,
      // 2+ slides → publish as a carousel; createSocialPost collapses a
      // single-entry list back to a normal one-image post.
      ...(slideUrls.length > 1 ? { mediaUrls: slideUrls } : {}),
      graphicId: graphic.id,
    };
  }

  // A post is created only when the owner SCHEDULES.
  //
  // Save and Schedule are two decisions, not one with a date attached. Saving
  // keeps the content — the item is decided and the asset is in the library —
  // and commits to publishing nothing; scheduling is the commitment, and a
  // social post is what a commitment looks like. Creating a draft post for a
  // Save put a row in the socials queue for something the owner had only said
  // they wanted to keep.
  let postId: string | null = null;
  if (isScheduling) {
    // createSocialPost derives platforms + platformSettings from the page IDs.
    const postResult = await createSocialPost(db, {
      organizationId,
      createdById,
      title,
      caption,
      pageIds: targetPageIds,
      scheduledAt,
      status,
      ...media,
    });
    if (!postResult.success) {
      return err(
        new FeatureError(
          postResult.error.code as ErrorCode,
          postResult.error.message
        )
      );
    }
    postId = postResult.data.id;
  }

  // Flip the slot to accepted, persisting the resolved review fields and the
  // resulting post id. The `reviewStatus = 'pending'` guard makes this a
  // no-op under a concurrent decide.
  //
  // The caption goes to the ATTEMPT — an accept can carry a hand-edit from the
  // review box, and that edit belongs to the cut being accepted. Both writes
  // are one transaction: an accepted slot whose caption did not save would
  // schedule a post the owner never approved the words for.
  const [updated] = await withOrgScope(
    (tx) =>
      (tx as DbConnection).transaction(async (trx) => {
        const [row] = await trx
          .update(contentItem)
          .set({
            reviewStatus: 'accepted',
            decidedAt: new Date(),
            scheduledAt,
            targetPageIds,
            scheduledSocialPostId: postId,
          })
          .where(
            and(
              eq(contentItem.id, itemId),
              eq(contentItem.reviewStatus, 'pending')
            )
          )
          .returning();

        if (row) {
          await trx
            .update(contentAttempt)
            .set({ caption: caption ?? null })
            .where(eq(contentAttempt.id, attempt.id));
        }

        return row ? [row] : [];
      }),
    { db }
  );

  if (!updated) {
    return err(
      new FeatureError(
        ErrorCodes.CONFLICT,
        'Concurrent update — please refresh and try again'
      )
    );
  }

  // Deciding an item can empty the review queue, which is what 'completed'
  // means. Recomputed rather than counted down, so it stays right however the
  // queue got there. Best-effort: the accept has already happened, and a stale
  // batch status must not turn a scheduled post into an error.
  if (updated.batchId) {
    await settleBatchStatus(db, { batchId: updated.batchId });
  }

  return ok(updated);
};

export const acceptBatchItem = (
  db: DbConnection,
  input: AcceptBatchItemInput
) =>
  trackedResult(
    'contentBatches.acceptBatchItem',
    () => acceptBatchItemImpl(db, input),
    {
      properties: {
        organizationId: input.organizationId,
        itemId: input.itemId,
      },
    }
  );

export type AcceptBatchItemResult = Awaited<ReturnType<typeof acceptBatchItem>>;
